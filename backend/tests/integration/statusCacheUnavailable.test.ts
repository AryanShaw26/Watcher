import { afterAll, describe, expect, it } from 'vitest';
import { closeRedis, redis } from '../../src/redis/client.js';
import { getStatuses } from '../../src/redis/statusCache.js';

afterAll(async () => {
  await closeRedis();
});

describe('Redis status cache outage', () => {
  it('returns an empty map without throwing when the Redis connection is unavailable', async () => {
    redis.disconnect();
    await expect(getStatuses(['6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a12'])).resolves.toEqual(new Map());
  });
});
