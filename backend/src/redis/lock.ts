import crypto from 'node:crypto';
import { redis } from './client.js';
import { logger } from '../lib/logger.js';

const releaseScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export async function acquireLock(key: string, ttlMs: number): Promise<{token:string}|null> {
  const token = crypto.randomUUID();
  try {
    const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? {token} : null;
  } catch (error) {
    logger.warn({error}, 'Redis lock unavailable; proceeding without lock');
    return {token};
  }
}

export async function releaseLock(key: string, token: string): Promise<void> {
  try { await redis.eval(releaseScript, 1, key, token); }
  catch (error) { logger.warn({error}, 'Could not release Redis lock'); }
}
