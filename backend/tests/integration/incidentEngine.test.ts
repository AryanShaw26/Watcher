import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { pool } from '../../src/db/pool.js';
import { recordResult } from '../../src/modules/results/result.service.js';
import type { CheckResultEvent } from '../../src/queue/event.js';

const userId = crypto.randomUUID();
const monitorId = crypto.randomUUID();
const channelId = crypto.randomUUID();
const eventAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
let sequenceSeconds = 0;

function event(status: 'up' | 'down', seconds: number): CheckResultEvent {
  return {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    monitorId,
    checkedAt: eventAt(seconds),
    status,
    statusCode: status === 'up' ? 200 : 503,
    responseTimeMs: 42,
    error: status === 'up' ? null : 'Expected 200, got 503',
    source: 'scheduler',
  };
}

async function apply(sequence: Array<'up' | 'down'>) {
  const outcomes = [];
  for (const status of sequence) {
    sequenceSeconds += 1;
    outcomes.push(await recordResult(event(status, sequenceSeconds)));
  }
  return outcomes;
}

async function counts() {
  const [incidents, notifications] = await Promise.all([
    pool.query('SELECT id,resolved_at,failed_checks FROM incidents WHERE monitor_id=$1', [
      monitorId,
    ]),
    pool.query('SELECT type,status FROM notifications WHERE monitor_id=$1 ORDER BY type', [
      monitorId,
    ]),
  ]);
  return { incidents: incidents.rows, notifications: notifications.rows };
}

beforeAll(async () => {
  await pool.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)', [
    userId,
    `incident-${userId}@example.invalid`,
    'test-hash',
  ]);
  await pool.query(
    `INSERT INTO monitors
       (id,user_id,name,url,method,interval_seconds,expected_status_code,timeout_ms)
     VALUES ($1,$2,'Incident monitor','https://example.com','GET',60,200,10000)`,
    [monitorId, userId],
  );
  await pool.query(
    `INSERT INTO notification_channels
       (id,user_id,type,name,target_encrypted,signing_secret_encrypted)
     VALUES ($1,$2,'webhook','Test channel','v1:unused','v1:unused')`,
    [channelId, userId],
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await pool.end();
});

beforeEach(async () => {
  sequenceSeconds = 0;
  await pool.query('DELETE FROM notifications WHERE monitor_id=$1', [monitorId]);
  await pool.query('DELETE FROM incidents WHERE monitor_id=$1', [monitorId]);
  await pool.query('DELETE FROM check_results WHERE monitor_id=$1', [monitorId]);
  await pool.query(
    `UPDATE monitors SET current_status='pending',consecutive_failures=0,consecutive_successes=0,
       failure_streak_started_at=NULL,failure_threshold=3,recovery_threshold=2,alerts_enabled=true,
       last_checked_at=NULL,last_response_time_ms=NULL,last_status_code=NULL,last_error=NULL
     WHERE id=$1`,
    [monitorId],
  );
  await pool.query('UPDATE notification_channels SET is_active=true WHERE id=$1', [channelId]);
});

describe('recordResult incident transitions', () => {
  it('does not open before the failure threshold and enqueues once when reached', async () => {
    await apply(['down', 'down']);
    expect((await counts()).incidents).toHaveLength(0);

    const outcomes = await apply(['down']);
    const result = await counts();
    expect(outcomes[0].incident).toMatchObject({ action: 'opened' });
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].failed_checks).toBe(3);
    expect(result.notifications.filter((row) => row.type === 'incident.opened')).toHaveLength(1);
  });

  it('updates the same incident through later failures without duplicate open alerts', async () => {
    await apply(['down', 'down', 'down', 'down', 'down']);
    const result = await counts();

    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].failed_checks).toBe(5);
    expect(result.notifications.filter((row) => row.type === 'incident.opened')).toHaveLength(1);
  });

  it('resolves once after the configured consecutive-success threshold', async () => {
    const outcomes = await apply(['down', 'down', 'down', 'up']);
    expect(outcomes[3].incident).toBeNull();
    expect((await counts()).incidents[0].resolved_at).toBeNull();

    const last = await recordResult(event('up', 5));
    const result = await counts();
    expect(last.incident).toMatchObject({ action: 'resolved' });
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].resolved_at).not.toBeNull();
    expect(result.notifications.map((row) => row.type).sort()).toEqual([
      'incident.opened',
      'incident.resolved',
    ]);
  });

  it('resets the recovery streak after a failure while an incident is open', async () => {
    await apply(['down', 'down', 'down', 'up', 'down', 'up']);
    expect((await counts()).incidents[0].resolved_at).toBeNull();

    await recordResult(event('up', 7));
    expect((await counts()).incidents[0].resolved_at).not.toBeNull();
  });

  it('does not create incidents for a flapping sequence below threshold', async () => {
    await apply(['down', 'up', 'down', 'up']);
    expect((await counts()).incidents).toHaveLength(0);
  });

  it('ignores a duplicate and a late event for incident state', async () => {
    const duplicate = event('down', 1);
    await recordResult(duplicate);
    await recordResult(duplicate);
    await apply(['down', 'down']);
    const late = { ...event('down', -10), eventId: crypto.randomUUID() };
    const result = await recordResult(late);

    expect(result).toMatchObject({ inserted: true, applied: false, incident: null });
    expect((await counts()).incidents).toHaveLength(1);
  });

  it('records an incident but does not enqueue when alerts are disabled', async () => {
    await pool.query('UPDATE monitors SET alerts_enabled=false WHERE id=$1', [monitorId]);
    await apply(['down', 'down', 'down']);
    const result = await counts();

    expect(result.incidents).toHaveLength(1);
    expect(result.notifications).toHaveLength(0);
  });

  it('does not enqueue notifications for inactive channels', async () => {
    await pool.query('UPDATE notification_channels SET is_active=false WHERE id=$1', [channelId]);
    await apply(['down', 'down', 'down']);
    expect((await counts()).notifications).toHaveLength(0);
  });

  it('opens on the first failure when the threshold is one', async () => {
    await pool.query('UPDATE monitors SET failure_threshold=1 WHERE id=$1', [monitorId]);
    const [outcome] = await apply(['down']);
    expect(outcome.incident).toMatchObject({ action: 'opened' });
    expect((await counts()).incidents).toHaveLength(1);
  });
});
