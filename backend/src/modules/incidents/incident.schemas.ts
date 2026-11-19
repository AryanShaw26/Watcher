import { z } from 'zod';

export const incidentQuerySchema = z
  .object({
    status: z.enum(['open', 'resolved', 'all']).default('all'),
    monitorId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().datetime().optional(),
  })
  .strict();
