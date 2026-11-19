import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  connectTimeout: 5000,
  retryStrategy(attempt:number) {
    return Math.min(attempt * 250, 5000);
  }
});

redis.on('error', (error:Error) => logger.warn({ error: error.message }, 'Redis connection error'));
redis.on('connect', () => logger.info('Redis connected'));

export async function redisIsUp(): Promise<boolean> {
  try { return (await redis.ping()) === 'PONG'; }
  catch { return false; }
}

export async function closeRedis(): Promise<void> {
  if (redis.status !== 'end') await redis.quit().catch(() => redis.disconnect());
}

export function redisKey(key: string): string {
  return `${env.REDIS_KEY_PREFIX}${key}`;
}
