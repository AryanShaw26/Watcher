import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { CheckResultEvent } from '../queue/event.js';
import type { ResultQueue } from '../queue/types.js';
import { recordResult } from '../modules/results/result.service.js';
import { pool } from '../db/pool.js';
import { setStatusFromRow } from '../redis/statusCache.js';

export type PublishPath = 'queue' | 'fallback' | 'lost';
type PublishOptions = {
  fallbackEnabled?: boolean;
  publishTimeoutMs?: number;
  persist?: (event: CheckResultEvent) => Promise<{
    inserted: boolean;
    applied: boolean;
    previousStatus: 'pending' | 'up' | 'down' | null;
  }>;
  cache?: (monitorId: string) => Promise<void>;
};

export async function publishOrFallback(
  queue: ResultQueue,
  event: CheckResultEvent,
  options: PublishOptions = {},
): Promise<PublishPath> {
  const persist = options.persist ?? recordResult;
  const cache =
    options.cache ??
    (async (monitorId: string) => {
      const row = await pool.query('SELECT * FROM monitors WHERE id=$1', [monitorId]);
      if (row.rows[0]) await setStatusFromRow(row.rows[0]);
    });
  try {
    const timeoutMs = options.publishTimeoutMs ?? env.PUBLISH_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        queue.publish(event),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Queue publish timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    logger.info({ eventId: event.eventId, monitorId: event.monitorId, path: 'queue' }, 'published');
    return 'queue';
  } catch (error) {
    if (!(options.fallbackEnabled ?? env.QUEUE_FALLBACK_TO_DB)) {
      logger.error(
        { eventId: event.eventId, monitorId: event.monitorId, path: 'lost', error },
        'Result event could not be published',
      );
      return 'lost';
    }
    try {
      const stored = await persist(event);
      if (stored.applied) {
        try {
          await cache(event.monitorId);
        } catch (cacheError) {
          logger.warn(
            { eventId: event.eventId, monitorId: event.monitorId, cacheError },
            'Fallback result saved but status cache refresh failed',
          );
        }
      }
      logger.warn(
        { eventId: event.eventId, monitorId: event.monitorId, path: 'fallback' },
        'Result saved directly after queue publish failure',
      );
      return 'fallback';
    } catch (fallbackError) {
      logger.error(
        { eventId: event.eventId, monitorId: event.monitorId, path: 'lost', error, fallbackError },
        'Result fallback failed',
      );
      return 'lost';
    }
  }
}
