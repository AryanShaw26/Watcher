import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireLock } from './lock.js';
import { redis } from './client.js';
import { logger } from '../lib/logger.js';

describe('Redis lock fail-open behaviour', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a token and logs a warning when Redis is unavailable', async () => {
    const redisError = new Error('ECONNREFUSED');

    const redisSetSpy = vi
      .spyOn(redis, 'set')
      .mockRejectedValue(redisError);

    const loggerSpy = vi.spyOn(logger, 'warn');

    const result = await acquireLock('test:fail-open', 5000);

    // Lock acquisition should fail open.
    expect(result).not.toBeNull();

    // A valid UUID token should still be returned.
    expect(result?.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    // Redis SET should have been attempted.
    expect(redisSetSpy).toHaveBeenCalledOnce();

    // A warning should have been logged.
    expect(loggerSpy).toHaveBeenCalledWith(
      { error: redisError },
      'Redis lock unavailable; proceeding without lock'
    );
  });
});