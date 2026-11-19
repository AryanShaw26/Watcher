import type { ResultQueue } from '../queue/types.js';
import { createMessageHandler } from './handleMessage.js';
import { logger } from '../lib/logger.js';

export async function startConsumer(queue: ResultQueue): Promise<void> {
  await queue.consume(createMessageHandler(queue));
  logger.info('consumer started');
}
