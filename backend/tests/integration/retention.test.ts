import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { pool } from '../../src/db/pool.js';
import { runRetention } from '../../src/scheduler/retention.js';

const userId = crypto.randomUUID();
const monitorId = crypto.randomUUID();
const openIncidentId = crypto.randomUUID();
const resolvedIncidentId = crypto.randomUUID();
const oldResultEventId = crypto.randomUUID();
const recentResultEventId = crypto.randomUUID();
const oldTokenId = crypto.randomUUID();
const recentTokenId = crypto.randomUUID();
const oldSentNotificationId = crypto.randomUUID();
const oldPendingNotificationId = crypto.randomUUID();

beforeAll(async () => {
  await pool.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)', [
    userId,
    `retention-${userId}@example.invalid`,
    'test-hash',
  ]);
  await pool.query(
    `INSERT INTO monitors
       (id,user_id,name,url,method,interval_seconds,expected_status_code,timeout_ms)
     VALUES ($1,$2,'Retention monitor','https://example.com','GET',60,200,10000)`,
    [monitorId, userId],
  );
  await pool.query(
    `INSERT INTO incidents (id,monitor_id,started_at,resolved_at,failed_checks)
     VALUES
       ($1,$3,now()-interval '120 days',NULL,3),
       ($2,$3,now()-interval '120 days',now()-interval '119 days',3)`,
    [openIncidentId, resolvedIncidentId, monitorId],
  );
  await pool.query(
    `INSERT INTO notifications
       (id,user_id,channel_type,channel_name,monitor_id,incident_id,type,payload,status,created_at)
     VALUES
       ($1,$3,'webhook','Retention test',$4,$5,$6,'{}','sent',now()-interval '120 days'),
       ($2,$3,'webhook','Retention test',$4,$5,$6,'{}','pending',now()-interval '120 days')`,
    [
      oldSentNotificationId,
      oldPendingNotificationId,
      userId,
      monitorId,
      resolvedIncidentId,
      'incident.opened',
    ],
  );
  await pool.query(
    `INSERT INTO check_results (event_id,monitor_id,checked_at,status)
     VALUES
       ($1,$3,now()-interval '20 days','up'),
       ($2,$3,now()-interval '1 day','up')`,
    [oldResultEventId, recentResultEventId, monitorId],
  );
  await pool.query(
    `INSERT INTO refresh_tokens (id,user_id,family_id,token_hash,expires_at)
     VALUES
       ($1,$3,$4,$5,now()-interval '20 days'),
       ($2,$3,$6,$7,now()-interval '1 day')`,
    [
      oldTokenId,
      recentTokenId,
      userId,
      crypto.randomUUID(),
      `old-${oldTokenId}`,
      crypto.randomUUID(),
      `recent-${recentTokenId}`,
    ],
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id=$1', [userId]);
});

describe('retention', () => {
  it('removes expired data in scope but retains pending notifications and open incidents', async () => {
    await runRetention();
    const [results, incidents, notifications, tokens] = await Promise.all([
      pool.query('SELECT event_id FROM check_results WHERE event_id = ANY($1::uuid[])', [
        [oldResultEventId, recentResultEventId],
      ]),
      pool.query('SELECT id FROM incidents WHERE id = ANY($1::uuid[])', [
        [openIncidentId, resolvedIncidentId],
      ]),
      pool.query('SELECT id,status FROM notifications WHERE id = ANY($1::uuid[])', [
        [oldSentNotificationId, oldPendingNotificationId],
      ]),
      pool.query('SELECT id FROM refresh_tokens WHERE id = ANY($1::uuid[])', [
        [oldTokenId, recentTokenId],
      ]),
    ]);

    expect(results.rows.map((row) => row.event_id)).toEqual([recentResultEventId]);
    expect(incidents.rows.map((row) => row.id)).toEqual([openIncidentId]);
    expect(notifications.rows).toEqual([{ id: oldPendingNotificationId, status: 'pending' }]);
    expect(tokens.rows.map((row) => row.id)).toEqual([recentTokenId]);
  });
});
