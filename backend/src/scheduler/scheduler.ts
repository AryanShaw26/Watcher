import pLimit from 'p-limit';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { runCheck } from '../checker/runCheck.js';
import { recordResult } from '../modules/results/result.service.js';

let timer: NodeJS.Timeout | undefined;
let running = false;
let stopping = false;

export async function claimDueMonitors(limit = 50) {
  const result = await pool.query(
    `UPDATE monitors SET next_check_at=now() + (interval_seconds || ' seconds')::interval
     WHERE id IN (
       SELECT id FROM monitors
       WHERE is_active=true AND next_check_at<=now()
       ORDER BY next_check_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [limit]
  );
  return result.rows;
}

export type SchedulerMonitor = {
  id:string;url:string;method:'GET'|'HEAD';expected_status_code:number;timeout_ms:number;
};

export async function checkAndRecord(monitor: SchedulerMonitor) {
  const outcome = await runCheck({
    url: monitor.url,
    method: monitor.method,
    expectedStatusCode: monitor.expected_status_code,
    timeoutMs: monitor.timeout_ms
  });
  await recordResult({ id: monitor.id }, outcome);
  logger.info({
    monitorId: monitor.id,
    status: outcome.status,
    statusCode: outcome.statusCode,
    responseTimeMs: outcome.responseTimeMs
  }, 'check');
}

export async function tick() {
  if (running) return;
  running = true;
  try {
    const monitors = await claimDueMonitors();
    const limit = pLimit(env.CHECK_CONCURRENCY);
    await Promise.all(monitors.map((monitor) => limit(async () => {
      try { await checkAndRecord(monitor); } catch (error) { logger.error({ monitorId: monitor.id, error }, 'check failed'); }
    })));
  } finally {
    running = false;
  }
}

async function loop() {
  if (stopping) return;
  await tick();
  if (!stopping) timer = setTimeout(loop, env.SCHEDULER_TICK_SECONDS * 1000);
}

export function startScheduler(): void {
  if (!env.SCHEDULER_ENABLED) return;
  stopping = false;
  void loop();
}

export async function stopScheduler(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  const started = Date.now();
  while (running && Date.now() - started < 10000) await new Promise((resolve) => setTimeout(resolve, 50));
}
