import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { CheckResultEvent } from './event.js';
import type { QueueMessage, ResultQueue } from './types.js';

export class MemoryQueue implements ResultQueue {
  private messages: QueueMessage[] = [];
  private handler?: (msg: QueueMessage) => Promise<void>;
  private closed = false;
  private running = false;
  private dlq = 0;
  private waiters: Array<() => void> = [];

  constructor() {
    if (env.NODE_ENV === 'production') throw new Error('Memory queue is not allowed in production');
  }

  async publish(event: CheckResultEvent): Promise<void> {
    this.messages.push({
      key: event.monitorId,
      value: JSON.stringify(event),
      meta: { topic: env.KAFKA_TOPIC_RESULTS, id: event.eventId },
    });
    void this.process();
  }

  async consume(handler: (msg: QueueMessage) => Promise<void>): Promise<void> {
    this.handler = handler;
    this.closed = false;
    void this.process();
  }

  private async process(): Promise<void> {
    if (this.running || !this.handler || this.closed) return;
    const handler = this.handler;
    this.running = true;
    try {
      while (this.messages.length && !this.closed) {
        const message = this.messages[0];
        try {
          await handler(message);
          this.messages.shift();
        } catch (error) {
          logger.error({ error }, 'Memory queue handler failed; retrying');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
    } finally {
      this.running = false;
      if (!this.messages.length) this.waiters.splice(0).forEach((resolve) => resolve());
    }
  }

  async publishToDlq(
    msg: QueueMessage,
    reason: { error: string; attempts: number },
  ): Promise<void> {
    this.dlq++;
    logger.warn({ reason, topic: msg.meta.topic }, 'Memory queue DLQ message');
  }
  async getStats() {
    return { connected: !this.closed, lag: this.messages.length, dlqDepth: this.dlq };
  }
  async close() {
    this.closed = true;
  }
  async drain(): Promise<void> {
    if (!this.messages.length && !this.running) return;
    if (!this.handler) throw new Error('Memory queue has no consumer');
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    await this.process();
  }
  injectRaw(value: string, key = 'unknown') {
    this.messages.push({ key, value, meta: { topic: env.KAFKA_TOPIC_RESULTS } });
    void this.process();
  }
}
