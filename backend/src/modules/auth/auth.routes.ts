import { Router, type CookieOptions, type Request, type Response } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { signAccessToken } from '../../lib/tokens.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { loginLimiter, registerLimiter } from '../../middleware/rateLimit.js';
import { credentialsSchema } from './auth.schemas.js';
import { getUserById, login, register, revokeFamilyByToken, rotateRefreshToken } from './auth.service.js';

export const authRouter = Router();

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400000,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {})
});

function clearCookie(res: Response): void {
  res.clearCookie('watcher_rt', { ...cookieOptions(), maxAge: undefined });
}

function checkOrigin(req: Request): void {
  const origin = req.headers.origin;
  if (origin && !env.CORS_ORIGINS.split(',').map((item) => item.trim()).includes(origin)) {
    throw new AppError(403, 'FORBIDDEN_ORIGIN', 'Forbidden origin');
  }
}

authRouter.post('/register', registerLimiter, validate({ body: credentialsSchema }), async (req, res, next) => {
  try {
    const { user, session } = await register(req.body.email, req.body.password);
    res.cookie('watcher_rt', session.raw, cookieOptions());
    res.status(201).json({ accessToken: signAccessToken(user.id), user });
  } catch (error) { next(error); }
});

authRouter.post('/login', loginLimiter, validate({ body: credentialsSchema }), async (req, res, next) => {
  try {
    const { user, session } = await login(req.body.email, req.body.password);
    res.cookie('watcher_rt', session.raw, cookieOptions());
    res.json({ accessToken: signAccessToken(user.id), user });
  } catch (error) { next(error); }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    checkOrigin(req);
    const raw = req.cookies.watcher_rt as string | undefined;
    if (!raw) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
    const rotated = await rotateRefreshToken(raw);
    res.cookie('watcher_rt', rotated.raw, cookieOptions());
    res.json({ accessToken: signAccessToken(rotated.userId) });
  } catch (error) {
    clearCookie(res);
    next(error);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    checkOrigin(req);
    const raw = req.cookies.watcher_rt as string | undefined;
    if (raw) await revokeFamilyByToken(raw);
  } catch (error) { return next(error); }
  clearCookie(res);
  res.status(204).send();
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.userId!);
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
    res.json({ user });
  } catch (error) { next(error); }
});
