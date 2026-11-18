import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { AppError } from '../lib/errors.js';

const handler = (_req: Request, _res: unknown, next: (error: AppError) => void) =>
  next(new AppError(429, 'RATE_LIMITED', 'Too many requests'));

export const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, handler });
export const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, handler });
export const registerLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false, handler });
export const manualCheckLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.userId ?? req.ip ?? 'unknown',
  validate: { keyGeneratorIpFallback: false },
  handler
});
