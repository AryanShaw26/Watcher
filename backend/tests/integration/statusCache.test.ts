import { afterEach, describe, expect, it } from 'vitest';
import { getStatuses, setStatus, deleteStatus } from '../../src/redis/statusCache.js';
import { redisKey } from '../../src/redis/client.js';

const id = '6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a12';
afterEach(async () => deleteStatus(id));

describe('Redis status cache integration', () => {
  it('round-trips values and maps empty fields to null', async () => {
    await setStatus(id, {
      status: 'down',
      statusCode: 503,
      responseTimeMs: null,
      lastCheckedAt: '2026-01-01T10:00:00.000Z',
      lastError: null,
      consecutiveFailures: 2,
    });
    const status = (await getStatuses([id])).get(id);
    expect(status).toEqual({
      status: 'down',
      statusCode: 503,
      responseTimeMs: null,
      lastCheckedAt: '2026-01-01T10:00:00.000Z',
      lastError: null,
      consecutiveFailures: 2,
    });
    await deleteStatus(id);
    expect((await getStatuses([id])).has(id)).toBe(false);
  });

  it('uses the configured key prefix', async () => {
    await setStatus(id, {
      status: 'up',
      statusCode: 200,
      responseTimeMs: 1,
      lastCheckedAt: null,
      lastError: null,
      consecutiveFailures: 0,
    });
    expect(
      await (await import('../../src/redis/client.js')).redis.exists(redisKey(`status:${id}`)),
    ).toBe(1);
  });
});
