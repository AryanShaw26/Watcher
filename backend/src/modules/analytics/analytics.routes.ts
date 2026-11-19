import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { getMonitorStats, getMonitorTimeseries } from './analytics.service.js';

const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const querySchema = z.object({ window: z.enum(['24h', '7d']).default('24h') }).strict();

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

analyticsRouter.get(
  '/:id/stats',
  validate({ params: paramsSchema, query: querySchema }),
  async (req, res, next) => {
    try {
      const { window } = querySchema.parse(req.query);
      res.json(await getMonitorStats(req.userId!, String(req.params.id), window));
    } catch (error) {
      next(error);
    }
  },
);

analyticsRouter.get(
  '/:id/timeseries',
  validate({ params: paramsSchema, query: querySchema }),
  async (req, res, next) => {
    try {
      const { window } = querySchema.parse(req.query);
      res.json(await getMonitorTimeseries(req.userId!, String(req.params.id), window));
    } catch (error) {
      next(error);
    }
  },
);
