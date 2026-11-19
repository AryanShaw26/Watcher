import { z } from 'zod';

export const notificationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().datetime().optional(),
    status: z.enum(['pending', 'sending', 'sent', 'failed', 'suppressed']).optional(),
  })
  .strict();
