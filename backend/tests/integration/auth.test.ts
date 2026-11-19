import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { pool } from '../../src/db/pool.js';
import { buildApp } from '../../src/app.js';
import type { ResultQueue } from '../../src/queue/types.js';

const queue: ResultQueue = {
  publish: async () => undefined,
  consume: async () => undefined,
  publishToDlq: async () => undefined,
  getStats: async () => ({ connected: true, lag: 0, dlqDepth: 0 }),
  close: async () => undefined,
};
const email = `auth-${crypto.randomUUID()}@example.invalid`;
const password = 'valid-password-for-tests';
const api = request.agent(buildApp(queue));

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email=$1', [email]);
  await pool.end();
});

describe('authentication API', () => {
  it('registers, logs in, refreshes, and logs out a session', async () => {
    const registration = await api.post('/api/auth/register').send({ email, password }).expect(201);
    expect(registration.body.user.email).toBe(email);
    expect(registration.body.accessToken).toEqual(expect.any(String));
    expect(registration.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('watcher_rt=')]),
    );

    await api
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${registration.body.accessToken}`)
      .expect(200);

    const login = await api.post('/api/auth/login').send({ email, password }).expect(200);
    expect(login.body.user.email).toBe(email);

    const refresh = await api.post('/api/auth/refresh').expect(200);
    expect(refresh.body.accessToken).toEqual(expect.any(String));
    await api.post('/api/auth/logout').expect(204);
  });

  it('rejects invalid credentials', async () => {
    await api
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password-for-tests' })
      .expect(401);
  });
});
