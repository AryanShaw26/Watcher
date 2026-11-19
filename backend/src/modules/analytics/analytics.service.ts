import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { redis, redisKey } from '../../redis/client.js';

type Window = '24h' | '7d';

function intervalFor(window: Window): string {
  return window === '7d' ? '7 days' : '24 hours';
}

function rounded(value: unknown): number | null {
  return value === null || value === undefined ? null : Math.round(Number(value));
}

async function getCached<T>(key: string): Promise<T | null> {
  try {
    const value = await redis.get(redisKey(key));
    return value ? (JSON.parse(value) as T) : null;
  } catch (error) {
    logger.warn({ error }, 'Analytics cache read failed; querying Postgres');
    return null;
  }
}

async function setCached(key: string, value: unknown): Promise<void> {
  try {
    await redis.set(redisKey(key), JSON.stringify(value), 'EX', env.STATS_CACHE_TTL_SECONDS);
  } catch (error) {
    logger.warn({ error }, 'Analytics cache write failed');
  }
}

async function assertMonitorOwner(userId: string, monitorId: string): Promise<void> {
  const owned = await pool.query('SELECT id FROM monitors WHERE id=$1 AND user_id=$2', [
    monitorId,
    userId,
  ]);
  if (!owned.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Monitor not found');
}

export async function getMonitorStats(userId: string, monitorId: string, window: Window) {
  await assertMonitorOwner(userId, monitorId);
  const cacheKey = `cache:stats:${monitorId}:${window}`;
  const cached = await getCached<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

  const result = await pool.query(
    `SELECT
       count(*)::int AS total_checks,
       count(*) FILTER (WHERE status='down')::int AS failed_checks,
       avg(response_time_ms) FILTER (WHERE status='up' AND response_time_ms IS NOT NULL) AS avg_ms,
       min(response_time_ms) FILTER (WHERE status='up' AND response_time_ms IS NOT NULL) AS min_ms,
       max(response_time_ms) FILTER (WHERE status='up' AND response_time_ms IS NOT NULL) AS max_ms,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY response_time_ms)
         FILTER (WHERE status='up' AND response_time_ms IS NOT NULL) AS p50_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)
         FILTER (WHERE status='up' AND response_time_ms IS NOT NULL) AS p95_ms,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY response_time_ms)
         FILTER (WHERE status='up' AND response_time_ms IS NOT NULL) AS p99_ms
     FROM check_results
     WHERE monitor_id=$1 AND checked_at >= now() - $2::interval`,
    [monitorId, intervalFor(window)],
  );
  const row = result.rows[0];
  const totalChecks = Number(row.total_checks);
  const failedChecks = Number(row.failed_checks);
  const stats = {
    window,
    totalChecks,
    failedChecks,
    uptimePercent:
      totalChecks === 0
        ? null
        : Math.round(((totalChecks - failedChecks) / totalChecks) * 10000) / 100,
    avgResponseTimeMs: rounded(row.avg_ms),
    minResponseTimeMs: rounded(row.min_ms),
    maxResponseTimeMs: rounded(row.max_ms),
    p50ResponseTimeMs: rounded(row.p50_ms),
    p95ResponseTimeMs: rounded(row.p95_ms),
    p99ResponseTimeMs: rounded(row.p99_ms),
  };
  await setCached(cacheKey, stats);
  return stats;
}

export async function getMonitorTimeseries(userId: string, monitorId: string, window: Window) {
  await assertMonitorOwner(userId, monitorId);
  const cacheKey = `cache:series:${monitorId}:${window}`;
  const cached = await getCached<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

  const bucketMinutes = window === '7d' ? 120 : 15;
  const interval = window === '7d' ? '2 hours' : '15 minutes';
  const result = await pool.query(
    `SELECT date_bin($2::interval,checked_at,TIMESTAMPTZ '2000-01-01') AS bucket_start,
       count(*)::int AS total,
       count(*) FILTER (WHERE status='down')::int AS failed,
       avg(response_time_ms) FILTER (WHERE status='up' AND response_time_ms IS NOT NULL) AS avg_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)
         FILTER (WHERE status='up' AND response_time_ms IS NOT NULL) AS p95_ms
     FROM check_results
     WHERE monitor_id=$1 AND checked_at >= now() - $3::interval
     GROUP BY bucket_start
     ORDER BY bucket_start`,
    [monitorId, interval, intervalFor(window)],
  );
  const series = {
    window,
    bucketMinutes,
    buckets: result.rows.map((row) => ({
      start: new Date(row.bucket_start).toISOString(),
      total: Number(row.total),
      failed: Number(row.failed),
      avgResponseTimeMs: rounded(row.avg_ms),
      p95ResponseTimeMs: rounded(row.p95_ms),
    })),
  };
  await setCached(cacheKey, series);
  return series;
}
