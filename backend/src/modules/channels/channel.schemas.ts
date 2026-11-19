import { z } from 'zod';

const channelType = z.enum(['webhook', 'slack', 'discord', 'email']);

export const createChannelSchema = z
  .object({
    type: channelType,
    name: z.string().trim().min(1).max(100),
    url: z.string().max(2048).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === 'email' && value.url !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'Email channels do not accept a URL',
      });
    }
    if (value.type !== 'email' && !value.url) {
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'A URL is required for this channel type',
      });
    }
  });

export const updateChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
    url: z.string().max(2048).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const channelIdSchema = z.object({ id: z.string().uuid() }).strict();
