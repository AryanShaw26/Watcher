import { pool, withTransaction } from '../../db/pool.js';
import type { CheckOutcome } from '../../checker/runCheck.js';

export type MonitorRecord = {
  id: string;
};

export function mapResult(row: Record<string, unknown>) {
  return {
    id: row.id, checkedAt: row.checked_at, status: row.status, statusCode: row.status_code,
    responseTimeMs: row.response_time_ms, error: row.error
  };
}

export async function recordResult(monitor: MonitorRecord, outcome: CheckOutcome) {
  return withTransaction(async (client) => {
    const inserted = await client.query(
      'INSERT INTO check_results (monitor_id,checked_at,status,status_code,response_time_ms,error) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [monitor.id,outcome.checkedAt,outcome.status,outcome.statusCode,outcome.responseTimeMs,outcome.error]
    );
    const result = await client.query(
      `UPDATE monitors SET current_status=$1,last_checked_at=$2,last_response_time_ms=$3,last_status_code=$4,
       last_error=$5,consecutive_failures=(CASE WHEN $1='up' THEN 0 ELSE consecutive_failures+1 END),updated_at=now()
       WHERE id=$6 RETURNING *`,
      [outcome.status,outcome.checkedAt,outcome.responseTimeMs,outcome.statusCode,outcome.error,monitor.id]
    );
    return { monitor: result.rows[0], outcome, result: inserted.rows[0] };
  });
}
