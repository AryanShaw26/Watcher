import type { PoolClient } from 'pg';
import type { CheckResultEvent } from '../queue/event.js';

type MonitorState = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  alerts_enabled: boolean;
  failure_threshold: number;
  recovery_threshold: number;
  consecutive_failures: number;
  consecutive_successes: number;
  failure_streak_started_at: Date | string | null;
};

type IncidentRow = {
  id: string;
  started_at: Date | string;
  resolved_at: Date | string | null;
  failed_checks: number;
};

export type IncidentTransition = {
  action: 'opened' | 'resolved' | 'updated';
  id: string;
};

export async function applyIncidentTransition(
  client: PoolClient,
  monitor: MonitorState,
  event: CheckResultEvent,
): Promise<IncidentTransition | null> {
  const found = await client.query<IncidentRow>(
    'SELECT id,started_at,resolved_at,failed_checks FROM incidents WHERE monitor_id=$1 AND resolved_at IS NULL FOR UPDATE',
    [monitor.id],
  );
  const open = found.rows[0];

  if (event.status === 'down') {
    if (open) {
      await client.query(
        `UPDATE incidents SET failed_checks=failed_checks+1,last_error=$2,last_status_code=$3
         WHERE id=$1`,
        [open.id, event.error, event.statusCode],
      );
      return { action: 'updated', id: open.id };
    }

    if (monitor.consecutive_failures < monitor.failure_threshold) return null;

    const inserted = await client.query<IncidentRow>(
      `INSERT INTO incidents (monitor_id,started_at,failed_checks,opened_error,last_error,last_status_code)
       VALUES ($1,$2,$3,$4,$4,$5)
       ON CONFLICT (monitor_id) WHERE resolved_at IS NULL DO NOTHING
       RETURNING id,started_at,resolved_at,failed_checks`,
      [
        monitor.id,
        monitor.failure_streak_started_at ?? event.checkedAt,
        monitor.consecutive_failures,
        event.error,
        event.statusCode,
      ],
    );
    const incident =
      inserted.rows[0] ??
      (
        await client.query<IncidentRow>(
          'SELECT id,started_at,resolved_at,failed_checks FROM incidents WHERE monitor_id=$1 AND resolved_at IS NULL',
          [monitor.id],
        )
      ).rows[0];
    if (!incident) return null;
    if (inserted.rows[0])
      await enqueueNotifications(client, monitor, incident, 'incident.opened', event);
    return { action: inserted.rows[0] ? 'opened' : 'updated', id: incident.id };
  }

  if (open && monitor.consecutive_successes >= monitor.recovery_threshold) {
    const resolvedAt = event.checkedAt;
    const resolved = await client.query<IncidentRow>(
      `UPDATE incidents SET resolved_at=$2
       WHERE id=$1 AND resolved_at IS NULL
       RETURNING id,started_at,resolved_at,failed_checks`,
      [open.id, resolvedAt],
    );
    const incident = resolved.rows[0];
    if (!incident) return null;
    await enqueueNotifications(client, monitor, incident, 'incident.resolved', event);
    return { action: 'resolved', id: incident.id };
  }

  return null;
}

async function enqueueNotifications(
  client: PoolClient,
  monitor: MonitorState,
  incident: IncidentRow,
  type: 'incident.opened' | 'incident.resolved',
  event: CheckResultEvent,
): Promise<void> {
  if (!monitor.alerts_enabled) return;

  const resolvedAt = incident.resolved_at;
  const startedAt = new Date(incident.started_at);
  const payload = {
    monitor: { id: monitor.id, name: monitor.name, url: monitor.url },
    incident: {
      id: incident.id,
      startedAt: startedAt.toISOString(),
      resolvedAt: resolvedAt ? new Date(resolvedAt).toISOString() : null,
      durationSeconds: resolvedAt
        ? Math.max(0, Math.floor((new Date(resolvedAt).getTime() - startedAt.getTime()) / 1000))
        : null,
      failedChecks: incident.failed_checks,
    },
    check: {
      statusCode: event.statusCode,
      error: event.error,
      responseTimeMs: event.responseTimeMs,
    },
    createdAt: event.checkedAt,
  };

  await client.query(
    `INSERT INTO notifications
       (user_id,channel_id,channel_type,channel_name,monitor_id,incident_id,type,payload)
     SELECT user_id,id,type,name,$2,$3,$4,$5::jsonb
     FROM notification_channels
     WHERE user_id=$1 AND is_active=true
     ON CONFLICT (incident_id,channel_id,type)
       WHERE incident_id IS NOT NULL AND channel_id IS NOT NULL
       DO NOTHING`,
    [monitor.user_id, monitor.id, incident.id, type, JSON.stringify(payload)],
  );
}
