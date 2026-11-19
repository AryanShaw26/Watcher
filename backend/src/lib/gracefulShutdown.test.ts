import { describe, expect, it } from 'vitest';
import { waitForShutdownTask } from './gracefulShutdown.js';

describe('waitForShutdownTask', () => {
  it('reports completion before the deadline', async () => {
    await expect(waitForShutdownTask(Promise.resolve(), 100)).resolves.toEqual({ status: 'completed' });
  });

  it('reports failure without hiding the original error', async () => {
    const error = new Error('shutdown failed');
    await expect(waitForShutdownTask(Promise.reject(error), 100)).resolves.toEqual({ status: 'failed', error });
  });

  it('bounds tasks that do not complete', async () => {
    await expect(waitForShutdownTask(new Promise(() => undefined), 1)).resolves.toEqual({ status: 'timed-out' });
  });
});
