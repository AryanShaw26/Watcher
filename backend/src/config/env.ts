import 'dotenv/config';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const schema = z
  .object({
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
    RESULT_RETENTION_DAYS: z.coerce.number().int().positive().default(8),
    NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    INCIDENT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
    ALLOW_PRIVATE_TARGETS: z.preprocess((value) => value ?? 'false', booleanString),
    ROLES: z.string().default('api,scheduler,consumer,notifier'),
    APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
    ENCRYPTION_KEY: z.string().default(''),
    MAX_API_KEYS_PER_USER: z.coerce.number().int().positive().default(5),
    MAX_CHANNELS_PER_USER: z.coerce.number().int().positive().default(5),
    NOTIFIER_TICK_SECONDS: z.coerce.number().int().positive().default(5),
    NOTIFY_BATCH_SIZE: z.coerce.number().int().positive().default(20),
    NOTIFY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    NOTIFY_BACKOFF_SECONDS: z
      .string()
      .default('30,120,600,1800')
      .transform((value) => value.split(',').map((item) => Number(item.trim())))
      .pipe(z.array(z.number().int().positive()).min(1)),
    NOTIFY_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    ALERT_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(600),
    NOTIFY_MAX_PER_CHANNEL_PER_HOUR: z.coerce.number().int().positive().default(20),
    STATS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
    EMAIL_PROVIDER: z.enum(['none', 'resend']).default('none'),
    RESEND_API_KEY: z.string().default(''),
    EMAIL_FROM: z.string().default(''),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    REDIS_KEY_PREFIX: z.string().default('watcher:'),
    STATUS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
    LOCK_TTL_BUFFER_SECONDS: z.coerce.number().int().positive().default(15),
    RATE_LIMIT_STORE: z.enum(['redis', 'memory']).default('redis'),
    QUEUE_DRIVER: z.enum(['kafka', 'redis-streams', 'memory']).default('kafka'),
    QUEUE_FALLBACK_TO_DB: z.preprocess((value) => value ?? 'true', booleanString),
    PUBLISH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    CONSUMER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    CONSUMER_RETRY_BASE_MS: z.coerce.number().int().nonnegative().default(200),
    PIPELINE_LAG_WARN: z.coerce.number().int().nonnegative().default(50),
    REDIS_STREAM_MAXLEN: z.coerce.number().int().positive().default(10000),
    KAFKA_BROKERS: z.string().default('localhost:9092'),
    KAFKA_CLIENT_ID: z.string().default('watcher'),
    KAFKA_SSL: z.preprocess((value) => value ?? 'false', booleanString),
    KAFKA_SASL_MECHANISM: z.enum(['', 'plain', 'scram-sha-256', 'scram-sha-512']).default(''),
    KAFKA_USERNAME: z.string().default(''),
    KAFKA_PASSWORD: z.string().default(''),
    KAFKA_TOPIC_RESULTS: z.string().default('check.results'),
    KAFKA_TOPIC_DLQ: z.string().default('check.results.dlq'),
    KAFKA_TOPIC_PARTITIONS: z.coerce.number().int().positive().default(3),
    KAFKA_AUTO_CREATE_TOPICS: z.preprocess((value) => value ?? 'true', booleanString),
    KAFKA_CONSUMER_GROUP: z.string().default('watcher-result-writers'),
  })
  .superRefine((value, context) => {
    const roles = value.ROLES.split(',')
      .map((role) => role.trim())
      .filter(Boolean);
    if (roles.some((role) => !['api', 'scheduler', 'consumer', 'notifier'].includes(role))) {
      context.addIssue({
        code: 'custom',
        path: ['ROLES'],
        message: 'ROLES may contain only api, scheduler, consumer, notifier',
      });
    }
    if (roles.length && !value.REDIS_URL) {
      context.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when a role is active',
      });
    }
    if (value.QUEUE_DRIVER === 'kafka' && !value.KAFKA_BROKERS) {
      context.addIssue({
        code: 'custom',
        path: ['KAFKA_BROKERS'],
        message: 'KAFKA_BROKERS is required for the Kafka queue',
      });
    }
    if (value.NODE_ENV === 'production' && value.QUEUE_DRIVER === 'memory') {
      context.addIssue({
        code: 'custom',
        path: ['QUEUE_DRIVER'],
        message: 'memory queue is not allowed in production',
      });
    }
    if (value.NODE_ENV === 'production' && value.RATE_LIMIT_STORE === 'memory') {
      context.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_STORE'],
        message: 'memory rate limiting is not allowed in production',
      });
    }
    if (roles.some((role) => role === 'api' || role === 'notifier') && value.ENCRYPTION_KEY) {
      if (Buffer.from(value.ENCRYPTION_KEY, 'base64').length !== 32) {
        context.addIssue({
          code: 'custom',
          path: ['ENCRYPTION_KEY'],
          message: 'ENCRYPTION_KEY must be base64 encoding of exactly 32 bytes',
        });
      }
    } else if (roles.some((role) => role === 'api' || role === 'notifier')) {
      context.addIssue({
        code: 'custom',
        path: ['ENCRYPTION_KEY'],
        message: 'ENCRYPTION_KEY is required when api or notifier is active',
      });
    }
    if (value.EMAIL_PROVIDER === 'resend' && (!value.RESEND_API_KEY || !value.EMAIL_FROM)) {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message: 'RESEND_API_KEY and EMAIL_FROM are required when EMAIL_PROVIDER=resend',
      });
    }
  });

export const env = schema.parse(process.env);

if (env.NODE_ENV === 'production' && env.ALLOW_PRIVATE_TARGETS) {
  console.warn('ALLOW_PRIVATE_TARGETS=true in production');
}
