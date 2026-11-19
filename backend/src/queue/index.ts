import type { ResultQueue } from './types.js';
import { env } from '../config/env.js';
import { MemoryQueue } from './memory.queue.js';
import { KafkaQueue } from './kafka.queue.js';
import { RedisStreamsQueue } from './redisStreams.queue.js';

export function createQueue(): ResultQueue {
  switch (env.QUEUE_DRIVER) {
    case 'memory':
      return new MemoryQueue();
    case 'kafka':
      return new KafkaQueue();
    case 'redis-streams':
      return new RedisStreamsQueue();
  }
}
