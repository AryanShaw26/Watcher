import { afterEach, describe, expect, it } from 'vitest';
import { acquireLock, releaseLock } from '../../src/redis/lock.js';
import { redis, redisKey } from '../../src/redis/client.js';

const key = redisKey(`test:lock:${process.pid}`);
afterEach(async () => {
  await redis.del(key);
});

describe('Redis lock integration', () => {
  it('prevents a second holder and only releases with the matching token', async () => {
    const first = await acquireLock(key, 5000);
    expect(first).not.toBeNull();
    expect(await acquireLock(key, 5000)).toBeNull();
    await releaseLock(key, 'not-the-token');
    expect(await acquireLock(key, 5000)).toBeNull();
    await releaseLock(key, first!.token);
    expect(await acquireLock(key, 5000)).not.toBeNull();
  });

  it('expires after its TTL', async () => {
    expect(await acquireLock(key, 100)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await acquireLock(key, 1000)).not.toBeNull();
  });
});
