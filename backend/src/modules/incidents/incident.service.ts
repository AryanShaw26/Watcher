import { AppError } from '../../lib/errors.js';
import { pool } from '../../db/pool.js';

export async function listIncidents(
  userId: string,
  filter: {
    status: 'open' | 'resolved' | 'all';
    monitorId?: string;
    limit: number;
    before?: string;
  },
) {
  const values: unknown[] = [userId];
  const conditions = ['m.user_id=$1'];

  if (filter.monitorId) {
    const owned = await pool.query('SELECT id FROM monitors WHERE id=$1 AND user_id=$2', [
      filter.monitorId,
      userId,
    ]);
    if (!owned.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Monitor not found');
    values.push(filter.monitorId);
    conditions.push(`i.monitor_id=$${values.length}`);
  }
  if (filter.status === 'open') conditions.push('i.resolved_at IS NULL');
  if (filter.status === 'resolved') conditions.push('i.resolved_at IS NOT NULL');
  if (filter.before) {
    values.push(filter.before);
    conditions.push(`i.started_at < $${values.length}`);
  }
  values.push(filter.limit);

  const result = await pool.query(
    `SELECT i.id,i.monitor_id,m.name AS monitor_name,i.started_at,i.resolved_at,
       i.failed_checks,i.opened_error,i.last_error,i.last_status_code
     FROM incidents i
     JOIN monitors m ON m.id=i.monitor_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY i.started_at DESC
     LIMIT $${values.length}`,
    values,
  );
  const now = Date.now();
  return result.rows.map((row) => {
    const startedAt = new Date(row.started_at);
    const endedAt = row.resolved_at ? new Date(row.resolved_at) : new Date(now);
    return {
      id: row.id,
      monitorId: row.monitor_id,
      monitorName: row.monitor_name,
      status: row.resolved_at ? 'resolved' : 'open',
      startedAt: startedAt.toISOString(),
      resolvedAt: row.resolved_at ? endedAt.toISOString() : null,
      durationSeconds: Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)),
      failedChecks: Number(row.failed_checks),
      openedError: row.opened_error,
      lastError: row.last_error,
      lastStatusCode: row.last_status_code === null ? null : Number(row.last_status_code),
    };
  });
}
