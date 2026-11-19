import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { notificationQuerySchema } from './notification.schemas.js';
import { listNotifications } from './notification.service.js';

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

notificationRouter.get(
  '/',
  validate({ query: notificationQuerySchema }),
  async (req, res, next) => {
    try {
      const filter = notificationQuerySchema.parse(req.query);
      res.json({ notifications: await listNotifications(req.userId!, filter) });
    } catch (error) {
      next(error);
    }
  },
);
