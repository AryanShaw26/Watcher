import { z } from 'zod';

export const credentialsSchema = z
  .object({
    email: z.string().email().max(254).trim(),
    password: z.string().min(10).max(72),
  })
  .strict();
