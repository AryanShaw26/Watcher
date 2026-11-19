import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { pool } from '../../src/db/pool.js';
import { recordResult } from '../../src/modules/results/result.service.js';
import type { CheckResultEvent } from '../../src/queue/event.js';

const userId = crypto.randomUUID();
const monitorId = crypto.randomUUID();
const checkedAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const event = (status: 'up' | 'down', seconds: number): CheckResultEvent => ({
  schemaVersion: 1,
  eventId: crypto.randomUUID(),
  monitorId,
  checkedAt: checkedAt(seconds),
  status,
  statusCode: status === 'up' ? 200 : 503,
  responseTimeMs: 12,
  error: status === 'up' ? null : 'Expected 200, got 503',
  source: 'scheduler'
});

beforeAll(async () => {
  await pool.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)', [
    userId, `result-state-${userId}@example.invalid`, 'test-hash'
  ]);
  await pool.query(
    `INSERT INTO monitors (id,user_id,name,url,method,interval_seconds,expected_status_code,timeout_ms)
     VALUES ($1,$2,'Result state monitor','https://example.com','GET',60,200,10000)`,
    [monitorId, userId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM check_results WHERE monitor_id=$1', [monitorId]);
  await pool.query(
    `UPDATE monitors SET current_status='pending',consecutive_failures=0,last_checked_at=NULL,
       last_response_time_ms=NULL,last_status_code=NULL,last_error=NULL
     WHERE id=$1`,
    [monitorId]
  );
});

describe('recordResult state transitions', () => {
  it('inserts a duplicate event ID only once', async () => {
    const sameEvent = event('down', 1);
    expect(await recordResult(sameEvent)).toMatchObject({
      inserted: true, applied: true, previousStatus: 'pending'
    });
    expect(await recordResult(sameEvent)).toEqual({
      inserted: false, applied: false, previousStatus: null
    });
    const rows = await pool.query('SELECT count(*)::int AS count FROM check_results WHERE monitor_id=$1', [monitorId]);
    expect(rows.rows[0].count).toBe(1);
  });

  it('stores an older event without overwriting newer monitor state', async () => {
    expect(await recordResult(event('down', 10))).toMatchObject({
      inserted: true, applied: true, previousStatus: 'pending'
    });
    expect(await recordResult(event('up', 5))).toMatchObject({
      inserted: true, applied: false, previousStatus: 'down'
    });
    const monitor = await pool.query('SELECT current_status FROM monitors WHERE id=$1', [monitorId]);
    const rows = await pool.query('SELECT count(*)::int AS count FROM check_results WHERE monitor_id=$1', [monitorId]);
    expect(monitor.rows[0].current_status).toBe('down');
    expect(rows.rows[0].count).toBe(2);
  });

  it('increments consecutive failures on down and resets them on up', async () => {
    expect(await recordResult(event('down', 1))).toMatchObject({
      inserted: true, applied: true, previousStatus: 'pending'
    });
    expect(await recordResult(event('down', 2))).toMatchObject({
      inserted: true, applied: true, previousStatus: 'down'
    });
    expect(await recordResult(event('up', 3))).toMatchObject({
      inserted: true, applied: true, previousStatus: 'down'
    });

    const monitor = await pool.query(
      'SELECT current_status,consecutive_failures FROM monitors WHERE id=$1',
      [monitorId]
    );
    expect(monitor.rows[0]).toEqual({ current_status: 'up', consecutive_failures: 0 });
  });
});
