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
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().positive().default(10),
  CHECK_CONCURRENCY: z.coerce.number().int().positive().default(10),
  MIN_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  MAX_MONITORS_PER_USER: z.coerce.number().int().positive().default(10),
  DEFAULT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  RESULT_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  ALLOW_PRIVATE_TARGETS: z.preprocess((value) => value ?? 'false', booleanString),
  ROLES: z.string().default('api,scheduler,consumer'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_KEY_PREFIX: z.string().default('watcher:'),
  STATUS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  LOCK_TTL_BUFFER_SECONDS: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_STORE: z.enum(['redis','memory']).default('redis'),
  QUEUE_DRIVER: z.enum(['kafka','redis-streams','memory']).default('kafka'),
  QUEUE_FALLBACK_TO_DB: z.preprocess((value) => value ?? 'true', booleanString),
  PUBLISH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  CONSUMER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  CONSUMER_RETRY_BASE_MS: z.coerce.number().int().nonnegative().default(200),
  PIPELINE_LAG_WARN: z.coerce.number().int().nonnegative().default(50),
  REDIS_STREAM_MAXLEN: z.coerce.number().int().positive().default(10000),
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('watcher'),
  KAFKA_SSL: z.preprocess((value) => value ?? 'false', booleanString),
  KAFKA_SASL_MECHANISM: z.enum(['','plain','scram-sha-256','scram-sha-512']).default(''),
  KAFKA_USERNAME: z.string().default(''),
  KAFKA_PASSWORD: z.string().default(''),
  KAFKA_TOPIC_RESULTS: z.string().default('check.results'),
  KAFKA_TOPIC_DLQ: z.string().default('check.results.dlq'),
  KAFKA_TOPIC_PARTITIONS: z.coerce.number().int().positive().default(3),
  KAFKA_AUTO_CREATE_TOPICS: z.preprocess((value) => value ?? 'true', booleanString),
  KAFKA_CONSUMER_GROUP: z.string().default('watcher-result-writers')
}).superRefine((value, context) => {
  const roles = value.ROLES.split(',').map((role) => role.trim()).filter(Boolean);
  if (roles.some((role) => !['api','scheduler','consumer'].includes(role))) {
    context.addIssue({ code: 'custom', path: ['ROLES'], message: 'ROLES may contain only api, scheduler, consumer' });
  }
  if (roles.length && !value.REDIS_URL) {
    context.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'REDIS_URL is required when a role is active' });
  }
  if (value.QUEUE_DRIVER === 'kafka' && !value.KAFKA_BROKERS) {
    context.addIssue({ code: 'custom', path: ['KAFKA_BROKERS'], message: 'KAFKA_BROKERS is required for the Kafka queue' });
  }
  if (value.NODE_ENV === 'production' && value.QUEUE_DRIVER === 'memory') {
    context.addIssue({ code: 'custom', path: ['QUEUE_DRIVER'], message: 'memory queue is not allowed in production' });
  }
  if (value.NODE_ENV === 'production' && value.RATE_LIMIT_STORE === 'memory') {
    context.addIssue({ code: 'custom', path: ['RATE_LIMIT_STORE'], message: 'memory rate limiting is not allowed in production' });
  }
});

export const env = schema.parse(process.env);

if (env.NODE_ENV === 'production' && env.ALLOW_PRIVATE_TARGETS) {
  console.warn('ALLOW_PRIVATE_TARGETS=true in production');
}
