import pLimit from 'p-limit';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { runCheck } from '../checker/runCheck.js';
import { buildEvent } from '../queue/event.js';
import type { ResultQueue } from '../queue/types.js';
import { acquireLock, releaseLock } from '../redis/lock.js';
import { redisKey } from '../redis/client.js';
import { publishOrFallback } from './publish.js';

let timer:NodeJS.Timeout|undefined;
let running=false;
let stopping=false;
let activeQueue:ResultQueue|undefined;

export async function claimDueMonitors(limit=50) {
  const result=await pool.query(
    `UPDATE monitors SET next_check_at=now() + (interval_seconds || ' seconds')::interval
     WHERE id IN (
       SELECT id FROM monitors
       WHERE is_active=true AND next_check_at<=now()
       ORDER BY next_check_at
       LIMIT $1 FOR UPDATE SKIP LOCKED
     ) RETURNING *`,
    [limit]
  );
  return result.rows;
}

export type SchedulerMonitor={id:string;url:string;method:'GET'|'HEAD';expected_status_code:number;timeout_ms:number};

async function checkAndPublish(monitor:SchedulerMonitor,queue:ResultQueue) {
  const key=redisKey(`lock:check:${monitor.id}`);
  const lock=await acquireLock(key,monitor.timeout_ms+env.LOCK_TTL_BUFFER_SECONDS*1000);
  if(!lock) {
    logger.debug({monitorId:monitor.id},'Monitor check skipped because lock is held');
    return;
  }
  let eventId:string|undefined;
  let path:'queue'|'fallback'|'lost';
  try {
    const outcome=await runCheck({
      url:monitor.url,method:monitor.method,
      expectedStatusCode:monitor.expected_status_code,timeoutMs:monitor.timeout_ms
    });
    const event=buildEvent(monitor,outcome,'scheduler');
    eventId=event.eventId;
    path=await publishOrFallback(queue,event);
    logger.info({
      eventId,monitorId:monitor.id,status:outcome.status,
      responseTimeMs:outcome.responseTimeMs,path
    },'check completed');
  } finally {
    await releaseLock(key,lock.token);
  }
}

export async function tick(queue=activeQueue) {
  if(running||!queue)return;
  running=true;
  try {
    const monitors=await claimDueMonitors();
    const limit=pLimit(env.CHECK_CONCURRENCY);
    await Promise.all(monitors.map((monitor)=>limit(async()=>{
      try { await checkAndPublish(monitor,queue); }
      catch(error) { logger.error({monitorId:monitor.id,error},'Check failed'); }
    })));
  } finally { running=false; }
}

async function loop() {
  if(stopping||!activeQueue)return;
  try { await tick(activeQueue); }
  catch(error) { logger.error({error},'Scheduler tick failed'); }
  if(!stopping)timer=setTimeout(()=>void loop(),env.SCHEDULER_TICK_SECONDS*1000);
}

export function startScheduler(queue:ResultQueue):void {
  activeQueue=queue;
  stopping=false;
  void loop();
  logger.info('scheduler started');
}

export async function stopScheduler():Promise<void> {
  stopping=true;
  if(timer)clearTimeout(timer);
  const started=Date.now();
  while(running&&Date.now()-started<10000)await new Promise((resolve)=>setTimeout(resolve,50));
  activeQueue=undefined;
}
