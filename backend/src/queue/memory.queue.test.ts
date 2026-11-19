import { describe, expect, it } from 'vitest';
import { MemoryQueue } from './memory.queue.js';
import type { CheckResultEvent } from './event.js';

describe('memory queue', () => {
  it('delivers published events to its consumer', async () => {
    const queue = new MemoryQueue();
    const received: string[] = [];
    await queue.consume(async (message) => {
      received.push(message.value);
    });
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
    await queue.publish(event);
    await queue.drain();
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0])).toMatchObject({ eventId: event.eventId });
    await queue.close();
  });
});
