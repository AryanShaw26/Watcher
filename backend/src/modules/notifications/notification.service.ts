import { pool } from '../../db/pool.js';

export async function listNotifications(
  userId: string,
  filter: { limit: number; before?: string; status?: string },
) {
  const values: unknown[] = [userId];
  const conditions = ['n.user_id=$1'];
  if (filter.before) {
    values.push(filter.before);
    conditions.push(`n.created_at < $${values.length}`);
  }
  if (filter.status) {
    values.push(filter.status);
    conditions.push(`n.status = $${values.length}`);
  }
  values.push(filter.limit);
  const result = await pool.query(
    `SELECT n.id,n.type,n.status,n.channel_type,n.channel_name,
       n.payload->'monitor'->>'name' AS monitor_name,n.incident_id,n.attempts,
       n.last_error,n.created_at,n.sent_at
     FROM notifications n
     WHERE ${conditions.join(' AND ')}
     ORDER BY n.created_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    channelType: row.channel_type,
    channelName: row.channel_name,
    monitorName: row.monitor_name,
    incidentId: row.incident_id,
    attempts: Number(row.attempts),
    lastError: row.last_error,
    createdAt: new Date(row.created_at).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
  }));
}
