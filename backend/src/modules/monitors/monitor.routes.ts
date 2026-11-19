import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { manualCheckLimiter } from '../../middleware/rateLimit.js';
import { createMonitorSchema, patchMonitorSchema, uuidParamSchema } from './monitor.schemas.js';
import { createMonitor, deleteMonitor, getMonitor, listMonitors, updateMonitor } from './monitor.service.js';
import { pool } from '../../db/pool.js';
import { assertPublicUrl } from '../../lib/ssrf.js';
import { runCheck } from '../../checker/runCheck.js';
import { mapResult, recordResult } from '../results/result.service.js';
import { AppError } from '../../lib/errors.js';
import { buildEvent } from '../../queue/event.js';
import { setStatusFromRow } from '../../redis/statusCache.js';

export const monitorRouter = Router();
monitorRouter.use(requireAuth);

monitorRouter.post('/', validate({ body: createMonitorSchema }), async (req, res, next) => {
  try { res.status(201).json({ monitor: await createMonitor(req.userId!, req.body) }); } catch (error) { next(error); }
});
monitorRouter.get('/', async (req, res, next) => {
  try { res.json({ monitors: await listMonitors(req.userId!) }); } catch (error) { next(error); }
});
monitorRouter.get('/:id', validate({ params: uuidParamSchema }), async (req, res, next) => {
  try { res.json({ monitor: await getMonitor(req.userId!, String(req.params.id)) }); } catch (error) { next(error); }
});
monitorRouter.patch('/:id', validate({ params: uuidParamSchema, body: patchMonitorSchema }), async (req, res, next) => {
  try { res.json({ monitor: await updateMonitor(req.userId!, String(req.params.id), req.body) }); } catch (error) { next(error); }
});
monitorRouter.delete('/:id', validate({ params: uuidParamSchema }), async (req, res, next) => {
  try { await deleteMonitor(req.userId!, String(req.params.id)); res.status(204).send(); } catch (error) { next(error); }
});

monitorRouter.get('/:id/results', validate({
  params: uuidParamSchema,
  query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), before: z.string().datetime().optional() }).strict()
}), async (req, res, next) => {
  try {
    const owned = await pool.query('SELECT id FROM monitors WHERE id=$1 AND user_id=$2', [req.params.id,req.userId]);
    if (!owned.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Monitor not found');
    const before = req.query.before ? 'AND checked_at < $3' : '';
    const values: unknown[] = [req.params.id,req.query.limit];
    if (req.query.before) values.push(req.query.before);
    const result = await pool.query(
      `SELECT * FROM check_results WHERE monitor_id=$1 ${before} ORDER BY checked_at DESC LIMIT $2`,
      values
    );
    res.json({ results: result.rows.map(mapResult) });
  } catch (error) { next(error); }
});

monitorRouter.get('/:id/stats', validate({
  params: uuidParamSchema,
  query: z.object({ window: z.enum(['24h','7d']).default('24h') }).strict()
}), async (req, res, next) => {
  try {
    const owned = await pool.query('SELECT id FROM monitors WHERE id=$1 AND user_id=$2', [req.params.id,req.userId]);
    if (!owned.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Monitor not found');
    const interval = req.query.window === '7d' ? '7 days' : '24 hours';
    const result = await pool.query(
      `SELECT count(*)::int total,
       count(*) filter (where status='down')::int failed,
       avg(response_time_ms) avg_ms
       FROM check_results WHERE monitor_id=$1 AND checked_at >= now() - $2::interval`,
      [req.params.id, interval]
    );
    const row = result.rows[0];
    const total = row.total;
    const avg = row.avg_ms === null ? null : Math.round(Number(row.avg_ms));
    res.json({
      window: req.query.window, totalChecks: total, failedChecks: row.failed,
      uptimePercent: total === 0 ? null : Math.round(((total - row.failed) / total) * 10000) / 100,
      avgResponseTimeMs: avg
    });
  } catch (error) { next(error); }
});

monitorRouter.post('/:id/check', manualCheckLimiter, validate({ params: uuidParamSchema }), async (req, res, next) => {
  try {
    const owned = await pool.query('SELECT * FROM monitors WHERE id=$1 AND user_id=$2', [req.params.id,req.userId]);
    if (!owned.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Monitor not found');
    await assertPublicUrl(owned.rows[0].url);
    const outcome = await runCheck({
      url: owned.rows[0].url, method: owned.rows[0].method,
      expectedStatusCode: owned.rows[0].expected_status_code, timeoutMs: owned.rows[0].timeout_ms
    });
    const event=buildEvent({id:owned.rows[0].id},outcome,'manual');
    const recorded=await recordResult(event);
    if(recorded.applied) {
      const updated=await pool.query('SELECT * FROM monitors WHERE id=$1',[owned.rows[0].id]);
      if(updated.rows[0])await setStatusFromRow(updated.rows[0]);
    }
    const result=await pool.query('SELECT * FROM check_results WHERE event_id=$1',[event.eventId]);
    const updatedMonitor=await getMonitor(req.userId!,String(req.params.id));
    res.json({result:mapResult(result.rows[0]),monitor:updatedMonitor});
  } catch (error) { next(error); }
});
