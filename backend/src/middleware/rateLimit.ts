import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { AppError } from '../lib/errors.js';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { redis, redisKey } from '../redis/client.js';
import { logger } from '../lib/logger.js';

const handler = (_req: Request, _res: unknown, next: (error: AppError) => void) =>
  next(new AppError(429, 'RATE_LIMITED', 'Too many requests'));

function options(windowMs:number,prefix:string) {
  return {
    windowMs,limit:prefix==='global'?120:prefix==='login'?10:prefix==='register'?5:10,
    standardHeaders:true as const,legacyHeaders:false,handler,
    passOnStoreError:true,
    ...(env.RATE_LIMIT_STORE==='redis'?{
      store:new RedisStore({
        prefix:redisKey(`rl:${prefix}:`),
        sendCommand:async(...args:string[])=>{
          try { return await redis.call(args[0],...args.slice(1)) as string|number|string[]; }
          catch(error) {
            logger.warn({error,limiter:prefix},'Redis rate-limit store unavailable; failing open');
            throw error;
          }
        }
      })
    }:{})
  };
}

export const apiLimiter = rateLimit(options(60_000,'global'));
export const loginLimiter = rateLimit(options(15*60_000,'login'));
export const registerLimiter = rateLimit(options(60*60_000,'register'));
export const manualCheckLimiter = rateLimit({
  ...options(60_000,'check'),
  keyGenerator:(req:Request)=>req.userId??req.ip??'unknown',
  validate:{keyGeneratorIpFallback:false}
});
