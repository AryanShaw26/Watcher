import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { assertPublicUrl } from '../../lib/ssrf.js';
import { deleteStatus, getStatuses } from '../../redis/statusCache.js';

export type MonitorInput = {
  name: string; url: string; method: 'GET'|'HEAD'; intervalSeconds: number;
  expectedStatusCode: number; timeoutMs: number;
};

export function mapMonitor(row: Record<string, unknown>) {
  return {
    id: row.id, name: row.name, url: row.url, method: row.method,
    intervalSeconds: row.interval_seconds, expectedStatusCode: row.expected_status_code,
    timeoutMs: row.timeout_ms, isActive: row.is_active, currentStatus: row.current_status,
    lastCheckedAt: row.last_checked_at, lastResponseTimeMs: row.last_response_time_ms,
    lastStatusCode: row.last_status_code, lastError: row.last_error,
    nextCheckAt: row.next_check_at, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export async function createMonitor(userId: string, input: MonitorInput) {
  await assertPublicUrl(input.url);
  const count = await pool.query('SELECT count(*)::int AS count FROM monitors WHERE user_id=$1', [userId]);
  if (count.rows[0].count >= env.MAX_MONITORS_PER_USER) throw new AppError(409, 'MONITOR_LIMIT_REACHED', 'Monitor limit reached');
  const result = await pool.query(
    `INSERT INTO monitors (user_id,name,url,method,interval_seconds,expected_status_code,timeout_ms,next_check_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *`,
    [userId,input.name,input.url,input.method,input.intervalSeconds,input.expectedStatusCode,input.timeoutMs]
  );
  return mapMonitor(result.rows[0]);
}

export async function listMonitors(userId: string) {
  const result = await pool.query(
    'SELECT * FROM monitors WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',
    [userId]
  );
  const statuses=await getStatuses(result.rows.map((row)=>row.id));
  return result.rows.map((row)=>{
    const cached=statuses.get(row.id);
    return mapMonitor(cached?{
      ...row,current_status:cached.status,last_status_code:cached.statusCode,
      last_response_time_ms:cached.responseTimeMs,last_checked_at:cached.lastCheckedAt,
      last_error:cached.lastError
    }:row);
  });
}

export async function getMonitor(userId: string, id: string) {
  const result = await pool.query('SELECT * FROM monitors WHERE id=$1 AND user_id=$2', [id,userId]);
  if (!result.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Monitor not found');
  const row=result.rows[0];
  const cached=(await getStatuses([id])).get(id);
  return mapMonitor(cached?{
    ...row,current_status:cached.status,last_status_code:cached.statusCode,
    last_response_time_ms:cached.responseTimeMs,last_checked_at:cached.lastCheckedAt,
    last_error:cached.lastError
  }:row);
}

export async function updateMonitor(userId: string, id: string, patch: Partial<MonitorInput & { isActive: boolean }>) {
  if (patch.url) await assertPublicUrl(patch.url);
  const current = await pool.query('SELECT * FROM monitors WHERE id=$1 AND user_id=$2', [id,userId]);
  if (!current.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Monitor not found');
  const fields: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => { fields.push(`${column}=$${values.length + 1}`); values.push(value); };
  if (patch.name !== undefined) add('name', patch.name);
  if (patch.url !== undefined) add('url', patch.url);
  if (patch.method !== undefined) add('method', patch.method);
  if (patch.expectedStatusCode !== undefined) add('expected_status_code', patch.expectedStatusCode);
  if (patch.timeoutMs !== undefined) add('timeout_ms', patch.timeoutMs);
  if (patch.isActive !== undefined) add('is_active', patch.isActive);
  if (patch.intervalSeconds !== undefined) {
    add('interval_seconds', patch.intervalSeconds);
    fields.push(`next_check_at=LEAST(next_check_at, now() + ($${values.length + 1} || ' seconds')::interval)`);
    values.push(patch.intervalSeconds);
  }
  if (patch.isActive === true) fields.push(`next_check_at=now()`);
  fields.push('updated_at=now()');
  values.push(id,userId);
  const result = await pool.query(
    `UPDATE monitors SET ${fields.join(',')} WHERE id=$${values.length - 1} AND user_id=$${values.length} RETURNING *`,
    values
  );
  return mapMonitor(result.rows[0]);
}

export async function deleteMonitor(userId: string, id: string) {
  const result = await pool.query('DELETE FROM monitors WHERE id=$1 AND user_id=$2', [id,userId]);
  if (result.rowCount === 0) throw new AppError(404, 'NOT_FOUND', 'Monitor not found');
  await deleteStatus(id);
}
