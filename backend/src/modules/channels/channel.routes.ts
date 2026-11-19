import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { channelMutationLimiter, channelTestLimiter } from '../../middleware/rateLimit.js';
import { channelIdSchema, createChannelSchema, updateChannelSchema } from './channel.schemas.js';
import {
  createChannel,
  deleteChannel,
  listChannels,
  queueTestNotification,
  updateChannel,
} from './channel.service.js';

export const channelRouter = Router();
channelRouter.use(requireAuth);

channelRouter.get('/', async (req, res, next) => {
  try {
    res.json(await listChannels(req.userId!));
  } catch (error) {
    next(error);
  }
});

channelRouter.post(
  '/',
  channelMutationLimiter,
  validate({ body: createChannelSchema }),
  async (req, res, next) => {
    try {
      res.status(201).json(await createChannel(req.userId!, req.body));
    } catch (error) {
      next(error);
    }
  },
);

channelRouter.patch(
  '/:id',
  channelMutationLimiter,
  validate({ params: channelIdSchema, body: updateChannelSchema }),
  async (req, res, next) => {
    try {
      res.json(await updateChannel(req.userId!, String(req.params.id), req.body));
    } catch (error) {
      next(error);
    }
  },
);

channelRouter.delete(
  '/:id',
  channelMutationLimiter,
  validate({ params: channelIdSchema }),
  async (req, res, next) => {
    try {
      await deleteChannel(req.userId!, String(req.params.id));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

channelRouter.post(
  '/:id/test',
  channelTestLimiter,
  validate({ params: channelIdSchema }),
  async (req, res, next) => {
    try {
      res.status(202).json(await queueTestNotification(req.userId!, String(req.params.id)));
    } catch (error) {
      next(error);
    }
  },
);
