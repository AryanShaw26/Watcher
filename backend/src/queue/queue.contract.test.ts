import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryQueue } from './memory.queue.js';
import type { CheckResultEvent } from './event.js';

const event: CheckResultEvent = {
  schemaVersion: 1,
  eventId: '6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a11',
  monitorId: '6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a12',
  checkedAt: new Date().toISOString(),
  status: 'up',
  statusCode: 200,
  responseTimeMs: 1,
  error: null,
  source: 'scheduler',
};

let queue: MemoryQueue | undefined;
afterEach(async () => {
  await queue?.close();
  queue = undefined;
});

describe('memory queue contract', () => {
  it('delivers published events to the consumer', async () => {
    queue = new MemoryQueue();
    const received: string[] = [];
    await queue.consume(async (message) => {
      received.push(message.value);
    });
    await queue.publish(event);
    await queue.drain();
    expect(JSON.parse(received[0])).toMatchObject({ eventId: event.eventId });
  });

  it('keeps a failed message pending until the handler succeeds', async () => {
    queue = new MemoryQueue();
    const received = vi.fn().mockRejectedValueOnce(new Error('retry')).mockResolvedValue(undefined);
    await queue.consume(received);
    await queue.publish(event);
    await queue.drain();
    expect(received).toHaveBeenCalledTimes(2);
    expect((await queue.getStats()).lag).toBe(0);
  });

  it('exposes dead-letter entries in its statistics', async () => {
    queue = new MemoryQueue();
    await queue.publishToDlq(
      { key: event.monitorId, value: JSON.stringify(event), meta: { topic: 'check.results' } },
      { error: 'invalid event', attempts: 0 },
    );
    expect((await queue.getStats()).dlqDepth).toBe(1);
  });

  it('does not consume new messages after close', async () => {
    queue = new MemoryQueue();
    const handler = vi.fn();
    await queue.consume(handler);
    await queue.close();
    await queue.publish(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handler).not.toHaveBeenCalled();
    expect((await queue.getStats()).lag).toBe(1);
  });
});
