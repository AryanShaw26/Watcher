import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { pool } from '../../src/db/pool.js';
import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/lib/tokens.js';

vi.mock('../../src/lib/ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/ssrf.js')>();
  return { ...actual, assertPublicUrl: async () => undefined };
});

const userId = crypto.randomUUID();
const app = buildApp();
const token = signAccessToken(userId);
const target = `https://example.com/hooks/${crypto.randomUUID()}`;

beforeAll(async () => {
  await pool.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)', [
    userId,
    `channels-${userId}@example.invalid`,
    'test-hash',
  ]);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id=$1', [userId]);
});

describe('notification channel API', () => {
  it('returns a masked target and one-time secret while storing encrypted values', async () => {
    const created = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'webhook', name: 'Test webhook', url: target })
      .expect(201);

    expect(created.body.channel.maskedTarget).not.toContain(target);
    expect(created.body.signingSecret).toMatch(/^whsec_/);

    const stored = await pool.query(
      'SELECT target_encrypted,signing_secret_encrypted FROM notification_channels WHERE id=$1',
      [created.body.channel.id],
    );
    expect(stored.rows[0].target_encrypted).toMatch(/^v1:/);
    expect(stored.rows[0].target_encrypted).not.toContain(target);
    expect(stored.rows[0].signing_secret_encrypted).toMatch(/^v1:/);
    expect(stored.rows[0].signing_secret_encrypted).not.toContain(created.body.signingSecret);

    const listed = await request(app)
      .get('/api/channels')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(target);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.signingSecret);
    expect(listed.body.channels[0].maskedTarget).toBe(created.body.channel.maskedTarget);

    await request(app)
      .patch(`/api/channels/${created.body.channel.id}`)
      .set('Authorization', `Bearer ${signAccessToken(crypto.randomUUID())}`)
      .send({ name: 'Changed by another user' })
      .expect(404);
  });

  it('rejects disallowed URL schemes and non-official Slack webhook hosts', async () => {
    const localTarget = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'webhook', name: 'Local target', url: 'https://localhost/hook' })
      .expect(400);
    expect(localTarget.body.error.code).toBe('URL_NOT_ALLOWED');

    const invalidSlack = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'slack', name: 'Invalid Slack', url: 'https://example.com/webhook' })
      .expect(400);
    expect(invalidSlack.body.error.code).toBe('VALIDATION_ERROR');
  });
});
