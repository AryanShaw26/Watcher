import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { pool } from '../../src/db/pool.js';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import type { ResultQueue } from '../../src/queue/types.js';

const requesterId = crypto.randomUUID();
const ownerId = crypto.randomUUID();
const monitorId = crypto.randomUUID();
const queue: ResultQueue = {
  publish: async () => undefined,
  consume: async () => undefined,
  publishToDlq: async () => undefined,
  getStats: async () => ({ connected: true, lag: 0, dlqDepth: 0 }),
  close: async () => undefined,
};

beforeAll(async () => {
  await pool.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3),($4,$5,$6)', [
    requesterId,
    `requester-${requesterId}@example.invalid`,
    'test-hash',
    ownerId,
    `owner-${ownerId}@example.invalid`,
    'test-hash',
  ]);
  await pool.query(
    `INSERT INTO monitors (id,user_id,name,url,method,interval_seconds,expected_status_code,timeout_ms)
     VALUES ($1,$2,'Foreign monitor','https://example.com','GET',60,200,10000)`,
    [monitorId, ownerId],
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id=ANY($1)', [[requesterId, ownerId]]);
  await pool.end();
});

describe('monitor ownership', () => {
  it('does not expose or mutate another user’s monitor on any monitor route', async () => {
    const api = request(buildApp(queue));
    const auth = `Bearer ${signAccessToken(requesterId)}`;

    const list = await api.get('/api/monitors').set('Authorization', auth).expect(200);
    expect(list.body.monitors.some((monitor: { id: string }) => monitor.id === monitorId)).toBe(
      false,
    );
    await api.get(`/api/monitors/${monitorId}`).set('Authorization', auth).expect(404);
    await api
      .patch(`/api/monitors/${monitorId}`)
      .set('Authorization', auth)
      .send({ name: 'changed' })
      .expect(404);
    await api.delete(`/api/monitors/${monitorId}`).set('Authorization', auth).expect(404);
    await api.get(`/api/monitors/${monitorId}/results`).set('Authorization', auth).expect(404);
    await api.get(`/api/monitors/${monitorId}/stats`).set('Authorization', auth).expect(404);
    await api.post(`/api/monitors/${monitorId}/check`).set('Authorization', auth).expect(404);

    const stillOwned = await pool.query('SELECT user_id,name FROM monitors WHERE id=$1', [
      monitorId,
    ]);
    expect(stillOwned.rows[0]).toEqual({ user_id: ownerId, name: 'Foreign monitor' });
  });
});
