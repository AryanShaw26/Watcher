import { beforeAll } from 'vitest';
import { redis } from '../../src/redis/client.js';

beforeAll(async () => {
  // The Redis client is shared by integration tests in this worker.
  // Reconnect it if it is new or was deliberately disconnected by an outage test.
  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }

  if (redis.status !== 'ready') {
    throw new Error(`Redis failed to initialize. Status: ${redis.status}`);
  }

  // Do not close the shared client in per-file setup teardown.
});
