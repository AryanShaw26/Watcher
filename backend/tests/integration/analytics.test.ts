import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { pool } from '../../src/db/pool.js';
import {
  getMonitorStats,
  getMonitorTimeseries,
} from '../../src/modules/analytics/analytics.service.js';
import { redis, redisKey } from '../../src/redis/client.js';

const userId = crypto.randomUUID();
const monitorId = crypto.randomUUID();
const cacheKeys = [
  redisKey(`cache:stats:${monitorId}:24h`),
  redisKey(`cache:series:${monitorId}:24h`),
];

async function insertResult(status: 'up' | 'down', responseTimeMs: number, offsetSeconds: number) {
  await pool.query(
    `INSERT INTO check_results (event_id,monitor_id,checked_at,status,response_time_ms)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      crypto.randomUUID(),
      monitorId,
      new Date(Date.now() - offsetSeconds * 1000),
      status,
      responseTimeMs,
    ],
  );
}

beforeAll(async () => {
  await pool.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)', [
    userId,
    `analytics-${userId}@example.invalid`,
    'test-hash',
  ]);
  await pool.query(
    `INSERT INTO monitors
       (id,user_id,name,url,method,interval_seconds,expected_status_code,timeout_ms)
     VALUES ($1,$2,'Analytics monitor','https://example.com','GET',60,200,10000)`,
    [monitorId, userId],
  );
});

beforeEach(async () => {
  await pool.query('DELETE FROM check_results WHERE monitor_id=$1', [monitorId]);
  await redis.del(...cacheKeys);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id=$1', [userId]);
});

describe('monitor analytics', () => {
  it('calculates fixed-dataset uptime, latency percentiles, and extrema', async () => {
    await insertResult('up', 100, 60);
    await insertResult('up', 200, 61);
    await insertResult('up', 300, 62);
    await insertResult('up', 400, 63);
    await insertResult('down', 900, 64);

    const stats = await getMonitorStats(userId, monitorId, '24h');
    expect(stats).toMatchObject({
      totalChecks: 5,
      failedChecks: 1,
      uptimePercent: 80,
      avgResponseTimeMs: 250,
      minResponseTimeMs: 100,
      maxResponseTimeMs: 400,
      p50ResponseTimeMs: 250,
      p95ResponseTimeMs: 385,
      p99ResponseTimeMs: 397,
    });

    const sql = await pool.query(
      `SELECT avg(response_time_ms) AS avg_ms,
         min(response_time_ms) AS min_ms,
         max(response_time_ms) AS max_ms,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY response_time_ms) AS p50_ms,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_ms,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY response_time_ms) AS p99_ms
       FROM check_results
       WHERE monitor_id=$1 AND status='up' AND response_time_ms IS NOT NULL`,
      [monitorId],
    );
    expect(stats.avgResponseTimeMs).toBe(Math.round(Number(sql.rows[0].avg_ms)));
    expect(stats.minResponseTimeMs).toBe(Number(sql.rows[0].min_ms));
    expect(stats.maxResponseTimeMs).toBe(Number(sql.rows[0].max_ms));
    expect(stats.p50ResponseTimeMs).toBe(Math.round(Number(sql.rows[0].p50_ms)));
    expect(stats.p95ResponseTimeMs).toBe(Math.round(Number(sql.rows[0].p95_ms)));
    expect(stats.p99ResponseTimeMs).toBe(Math.round(Number(sql.rows[0].p99_ms)));
  });

  it('returns null latency statistics when the window has no successful checks', async () => {
    await insertResult('down', 900, 60);

    await expect(getMonitorStats(userId, monitorId, '24h')).resolves.toMatchObject({
      totalChecks: 1,
      failedChecks: 1,
      uptimePercent: 0,
      avgResponseTimeMs: null,
      minResponseTimeMs: null,
      maxResponseTimeMs: null,
      p50ResponseTimeMs: null,
      p95ResponseTimeMs: null,
      p99ResponseTimeMs: null,
    });
  });

  it('returns sorted date_bin buckets with counts and latency summaries', async () => {
    await insertResult('up', 100, 60);
    await insertResult('up', 200, 61);
    await insertResult('up', 300, 62);
    await insertResult('up', 400, 63);
    await insertResult('down', 900, 64);

    const [series, sql] = await Promise.all([
      getMonitorTimeseries(userId, monitorId, '24h'),
      pool.query(
        `SELECT date_bin(interval '15 minutes',checked_at,TIMESTAMPTZ '2000-01-01') AS bucket_start,
           count(*)::int AS total,
           count(*) FILTER (WHERE status='down')::int AS failed,
           avg(response_time_ms) FILTER (WHERE status='up' AND response_time_ms IS NOT NULL) AS avg_ms,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)
             FILTER (WHERE status='up' AND response_time_ms IS NOT NULL) AS p95_ms
         FROM check_results WHERE monitor_id=$1
         GROUP BY bucket_start ORDER BY bucket_start`,
        [monitorId],
      ),
    ]);

    expect(series.bucketMinutes).toBe(15);
    expect(series.buckets).toEqual(
      sql.rows.map((row) => ({
        start: new Date(row.bucket_start).toISOString(),
        total: Number(row.total),
        failed: Number(row.failed),
        avgResponseTimeMs: Math.round(Number(row.avg_ms)),
        p95ResponseTimeMs: Math.round(Number(row.p95_ms)),
      })),
    );
    expect(series.buckets.map((bucket) => bucket.start)).toEqual(
      [...series.buckets.map((bucket) => bucket.start)].sort(),
    );
  });

  it('serves the cached stats within the TTL and checks ownership before reading cache', async () => {
    await insertResult('up', 100, 60);
    const first = await getMonitorStats(userId, monitorId, '24h');
    await insertResult('up', 1000, 61);
    await expect(getMonitorStats(userId, monitorId, '24h')).resolves.toEqual(first);

    await redis.set(
      redisKey(`cache:stats:${monitorId}:24h`),
      JSON.stringify({ window: '24h', totalChecks: 999 }),
    );
    await expect(getMonitorStats(crypto.randomUUID(), monitorId, '24h')).rejects.toThrow(
      'Monitor not found',
    );
  });
});
