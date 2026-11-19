import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { pool } from '../../src/db/pool.js';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import type { ResultQueue } from '../../src/queue/types.js';

const userId = crypto.randomUUID();
const monitorId = crypto.randomUUID();
const queue: ResultQueue = {
  publish: async () => undefined,
  consume: async () => undefined,
  publishToDlq: async () => undefined,
  getStats: async () => ({ connected: true, lag: 0, dlqDepth: 0 }),
  close: async () => undefined
};

beforeAll(async () => {
  await pool.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)', [
    userId, `monitor-fallback-${userId}@example.invalid`, 'test-hash'
  ]);
  await pool.query(
    `INSERT INTO monitors
      (id,user_id,name,url,method,interval_seconds,expected_status_code,timeout_ms,
       current_status,consecutive_failures,last_checked_at,last_response_time_ms,last_status_code,last_error)
     VALUES ($1,$2,'Database fallback','https://example.com','GET',60,200,10000,
       'up',0,now(),17,204,NULL)`,
    [monitorId, userId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await pool.end();
});

describe('monitor API cache miss', () => {
  it('uses the database status columns when no cached status exists', async () => {
    const response = await request(buildApp(queue))
      .get(`/api/monitors/${monitorId}`)
      .set('Authorization', `Bearer ${signAccessToken(userId)}`)
      .expect(200);
    expect(response.body.monitor).toMatchObject({
      currentStatus: 'up',
      lastResponseTimeMs: 17,
      lastStatusCode: 204
    });
  });
});
