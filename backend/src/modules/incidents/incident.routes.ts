import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { incidentQuerySchema } from './incident.schemas.js';
import { listIncidents } from './incident.service.js';

export const incidentRouter = Router();
incidentRouter.use(requireAuth);

incidentRouter.get('/', validate({ query: incidentQuerySchema }), async (req, res, next) => {
  try {
    const filter = incidentQuerySchema.parse(req.query);
    res.json({ incidents: await listIncidents(req.userId!, filter) });
  } catch (error) {
    next(error);
  }
});
