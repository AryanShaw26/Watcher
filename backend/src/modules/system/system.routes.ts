import { Router } from 'express';
import type { ResultQueue } from '../../queue/types.js';
import { requireAuth } from '../../middleware/auth.js';
import { getPipelineStatus } from './pipeline.service.js';

export function createSystemRouter(queue:ResultQueue) {
  const router=Router();
  router.get('/pipeline',requireAuth,async(_req,res,next)=>{
    try { res.json(await getPipelineStatus(queue)); }
    catch(error) { next(error); }
  });
  return router;
}
