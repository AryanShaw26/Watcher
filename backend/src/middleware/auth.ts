import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../lib/tokens.js';
import { AppError } from '../lib/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return next(new AppError(401, 'UNAUTHORIZED', 'Unauthorized'));
  try {
    req.userId = verifyAccessToken(header.slice(7));
    next();
  } catch {
    next(new AppError(401, 'UNAUTHORIZED', 'Unauthorized'));
  }
}
