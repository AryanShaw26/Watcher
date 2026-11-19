import { z } from 'zod';

const intervalValues = [60, 300, 600, 900, 1800, 3600] as const;
export const createMonitorSchema = z
  .object({
    name: z.string().min(1).max(100).trim(),
    url: z.string().max(2048),
    method: z.enum(['GET', 'HEAD']).default('GET'),
    intervalSeconds: z
      .enum(intervalValues.map(String) as [string, ...string[]])
      .transform(Number)
      .default(300),
    expectedStatusCode: z.number().int().min(100).max(599).default(200),
    timeoutMs: z.number().int().min(1000).max(30000).default(10000),
    failureThreshold: z.number().int().min(1).max(10).default(3),
    recoveryThreshold: z.number().int().min(1).max(10).default(2),
    alertsEnabled: z.boolean().default(true),
  })
  .strict();

export const patchMonitorSchema = z
  .object({
    name: z.string().min(1).max(100).trim().optional(),
    url: z.string().max(2048).optional(),
    method: z.enum(['GET', 'HEAD']).optional(),
    intervalSeconds: z
      .enum(intervalValues.map(String) as [string, ...string[]])
      .transform(Number)
      .optional(),
    expectedStatusCode: z.number().int().min(100).max(599).optional(),
    timeoutMs: z.number().int().min(1000).max(30000).optional(),
    isActive: z.boolean().optional(),
    failureThreshold: z.number().int().min(1).max(10).optional(),
    recoveryThreshold: z.number().int().min(1).max(10).optional(),
    alertsEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const uuidParamSchema = z.object({ id: z.string().uuid() });
