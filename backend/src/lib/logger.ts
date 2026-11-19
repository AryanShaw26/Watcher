import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    'password',
    'target',
    'url',
    'signingSecret',
    'ENCRYPTION_KEY',
    'RESEND_API_KEY',
  ],
});
