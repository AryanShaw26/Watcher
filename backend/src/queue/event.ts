import crypto from 'node:crypto';
import { z } from 'zod';
import type { CheckOutcome } from '../checker/runCheck.js';

export const checkResultEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    monitorId: z.string().uuid(),
    checkedAt: z.string().datetime({ offset: true }),
    status: z.enum(['up', 'down']),
    statusCode: z.number().int().min(100).max(599).nullable(),
    responseTimeMs: z.number().int().nonnegative().nullable(),
    error: z.string().max(500).nullable(),
    source: z.enum(['scheduler', 'manual']),
  })
  .strict();
export type CheckResultEvent = z.infer<typeof checkResultEventSchema>;

export function buildEvent(
  monitor: { id: string },
  outcome: CheckOutcome,
  source: 'scheduler' | 'manual',
): CheckResultEvent {
  return checkResultEventSchema.parse({
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    monitorId: monitor.id,
    checkedAt: outcome.checkedAt.toISOString(),
    status: outcome.status,
    statusCode: outcome.statusCode,
    responseTimeMs: outcome.responseTimeMs,
    error: outcome.error?.slice(0, 500) ?? null,
    source,
  });
}
