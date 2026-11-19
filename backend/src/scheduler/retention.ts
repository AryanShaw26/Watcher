import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export async function runRetention(): Promise<void> {
  while (true) {
    const result = await pool.query(
      `DELETE FROM check_results
       WHERE id IN (
         SELECT id FROM check_results
         WHERE checked_at < now() - ($1 || ' days')::interval
         ORDER BY checked_at
         LIMIT 5000
       )`,
      [env.RESULT_RETENTION_DAYS]
    );
    if (!result.rowCount) break;
  }
  logger.info('retention complete');
}

let retentionTimer: NodeJS.Timeout | undefined;
export function startRetention(): void {
  void runRetention().catch((error)=>logger.error({error},'Initial retention failed'));
  retentionTimer = setInterval(() => { void runRetention(); }, 3600000);
  retentionTimer.unref();
}
export function stopRetention(): void {
  if (retentionTimer) clearInterval(retentionTimer);
}
