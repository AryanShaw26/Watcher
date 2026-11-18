import 'dotenv/config';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.string().optional().default(''),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().positive().default(7),
  BCRYPT_COST: z.coerce.number().int().min(4).max(14).default(12),
  COOKIE_SECURE: z.preprocess((value) => value ?? 'false', booleanString),
  COOKIE_SAMESITE: z.enum(['lax', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional().default(''),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  SCHEDULER_ENABLED: z.preprocess((value) => value ?? 'true', booleanString),
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().positive().default(10),
  CHECK_CONCURRENCY: z.coerce.number().int().positive().default(10),
  MIN_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  MAX_MONITORS_PER_USER: z.coerce.number().int().positive().default(10),
  DEFAULT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  RESULT_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  ALLOW_PRIVATE_TARGETS: z.preprocess((value) => value ?? 'false', booleanString)
});

export const env = schema.parse(process.env);

if (env.NODE_ENV === 'production' && env.ALLOW_PRIVATE_TARGETS) {
  console.warn('ALLOW_PRIVATE_TARGETS=true in production');
}
