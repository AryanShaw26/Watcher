import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import {pool} from '../../src/db/pool.js';
import {recordResult} from '../../src/modules/results/result.service.js';
import {setStatus,deleteStatus} from '../../src/redis/statusCache.js';
import {closeRedis} from '../../src/redis/client.js';
import {buildApp} from '../../src/app.js';
import {signAccessToken} from '../../src/lib/tokens.js';
import type {CheckResultEvent} from '../../src/queue/event.js';
import type {ResultQueue} from '../../src/queue/types.js';

const userId=crypto.randomUUID();
const monitorId=crypto.randomUUID();
const email=`v2-test-${userId}@example.invalid`;
const at=(seconds:number)=>new Date(Date.now()+seconds*1000).toISOString();
const event=(eventId:string,checkedAt:string,status:'up'|'down'):CheckResultEvent=>({
  schemaVersion:1,eventId,monitorId,checkedAt,status,statusCode:status==='up'?200:503,
  responseTimeMs:20,error:status==='up'?null:'Expected 200, got 503',source:'scheduler'
});
const queue:ResultQueue={
  publish:async()=>undefined,consume:async()=>undefined,publishToDlq:async()=>undefined,
  getStats:async()=>({connected:true,lag:0,dlqDepth:0}),close:async()=>undefined
};

beforeAll(async()=>{
  await pool.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)',[userId,email,'test-hash']);
  await pool.query(
    `INSERT INTO monitors (id,user_id,name,url,method,interval_seconds,expected_status_code,timeout_ms)
     VALUES ($1,$2,'Integration monitor','https://example.com','GET',60,200,10000)`,
    [monitorId,userId]
  );
});
afterAll(async()=>{
  await pool.query('DELETE FROM users WHERE id=$1',[userId]);
  await pool.end();
  await closeRedis();
});

describe('recordResult integration',()=>{
  it('deduplicates event IDs and does not apply older statuses',async()=>{
    const newest=event(crypto.randomUUID(),at(10),'down');
    const first=await recordResult(newest);
    expect(first).toEqual({inserted:true,applied:true,previousStatus:'pending'});
    expect(await recordResult(newest)).toEqual({inserted:false,applied:false,previousStatus:null});

    const older=event(crypto.randomUUID(),at(5),'up');
    expect(await recordResult(older)).toEqual({inserted:true,applied:false,previousStatus:'down'});
    const rows=await pool.query('SELECT count(*)::int AS count FROM check_results WHERE monitor_id=$1',[monitorId]);
    const monitor=await pool.query('SELECT current_status,consecutive_failures FROM monitors WHERE id=$1',[monitorId]);
    expect(rows.rows[0].count).toBe(2);
    expect(monitor.rows[0]).toMatchObject({current_status:'down',consecutive_failures:1});
  });

  it('serves a cached status overlay through the authenticated monitor API',async()=>{
    await setStatus(monitorId,{
      status:'up',statusCode:204,responseTimeMs:7,lastCheckedAt:at(0),
      lastError:null,consecutiveFailures:0
    });
    const response=await request(buildApp(queue))
      .get('/api/monitors')
      .set('Authorization',`Bearer ${signAccessToken(userId)}`)
      .expect(200);
    expect(response.body.monitors.find((monitor:{id:string})=>monitor.id===monitorId)).toMatchObject({
      currentStatus:'up',lastStatusCode:204,lastResponseTimeMs:7
    });
    await deleteStatus(monitorId);
  });
});
