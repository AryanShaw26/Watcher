import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

async function deleteInBatches(
  table: 'check_results' | 'notifications' | 'incidents' | 'refresh_tokens',
  orderBy: 'checked_at' | 'created_at' | 'resolved_at',
  predicate: string,
  parameters: unknown[],
): Promise<number> {
  let total = 0;
  while (true) {
    const result = await pool.query(
      `WITH batch AS (
         SELECT id FROM ${table}
         WHERE ${predicate}
         ORDER BY ${orderBy}
         LIMIT 5000
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM ${table} AS target
       USING batch
       WHERE target.id = batch.id`,
      parameters,
    );
    total += result.rowCount ?? 0;
    if ((result.rowCount ?? 0) < 5000) return total;
  }
}

export async function runRetention(): Promise<void> {
  const results = await deleteInBatches(
    'check_results',
    'checked_at',
    `checked_at < now() - ($1 * interval '1 day')`,
    [env.RESULT_RETENTION_DAYS],
  );
  const notifications = await deleteInBatches(
    'notifications',
    'created_at',
    `created_at < now() - ($1 * interval '1 day') AND status IN ('sent','failed','suppressed')`,
    [env.NOTIFICATION_RETENTION_DAYS],
  );
  const incidents = await deleteInBatches(
    'incidents',
    'resolved_at',
    `resolved_at IS NOT NULL AND resolved_at < now() - ($1 * interval '1 day')`,
    [env.INCIDENT_RETENTION_DAYS],
  );
  const refreshTokens = await deleteInBatches(
    'refresh_tokens',
    'created_at',
    `(expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days')`,
    [],
  );
  logger.info({ results, notifications, incidents, refreshTokens }, 'retention complete');
}

let retentionTimer: NodeJS.Timeout | undefined;
export function startRetention(): void {
  void runRetention().catch((error) => logger.error({ error }, 'Initial retention failed'));
  retentionTimer = setInterval(() => {
    void runRetention();
  }, 3600000);
  retentionTimer.unref();
}
export function stopRetention(): void {
  if (retentionTimer) clearInterval(retentionTimer);
}
