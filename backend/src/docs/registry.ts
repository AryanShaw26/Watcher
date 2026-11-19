import { z } from 'zod';
import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { credentialsSchema } from '../modules/auth/auth.schemas.js';
import {
  createMonitorSchema,
  patchMonitorSchema,
  uuidParamSchema,
} from '../modules/monitors/monitor.schemas.js';
import {
  createChannelSchema,
  updateChannelSchema,
  channelIdSchema,
} from '../modules/channels/channel.schemas.js';
import { incidentQuerySchema } from '../modules/incidents/incident.schemas.js';
import { notificationQuerySchema } from '../modules/notifications/notification.schemas.js';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().uuid().optional(),
  }),
});
const idParams = uuidParamSchema;
const monitor = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    url: z.string(),
    currentStatus: z.enum(['pending', 'up', 'down']),
    failureThreshold: z.number(),
    recoveryThreshold: z.number(),
    alertsEnabled: z.boolean(),
    openIncident: z.object({ id: z.string().uuid(), startedAt: z.string() }).nullable(),
  })
  .passthrough();
const monitorResponse = z.object({ monitor });
const monitorsResponse = z.object({ monitors: z.array(monitor) });
const channel = z.object({
  id: z.string().uuid(),
  type: z.enum(['webhook', 'slack', 'discord', 'email']),
  name: z.string(),
  isActive: z.boolean(),
  maskedTarget: z.string().nullable(),
  createdAt: z.string(),
});
const channelResponse = z.object({ channel });
const channelCreateResponse = channelResponse.extend({ signingSecret: z.string().optional() });
const channelsResponse = z.object({
  channels: z.array(channel),
  availableTypes: z.array(z.enum(['webhook', 'slack', 'discord', 'email'])),
});
const incidentResponse = z.object({ incidents: z.array(z.record(z.string(), z.unknown())) });
const notificationsResponse = z.object({
  notifications: z.array(z.record(z.string(), z.unknown())),
});
const authResponse = z.object({
  accessToken: z.string(),
  user: z.record(z.string(), z.unknown()).optional(),
});
const idResult = z.object({ result: z.record(z.string(), z.unknown()) });
const resultList = z.object({ results: z.array(z.record(z.string(), z.unknown())) });
const statsResponse = z.object({
  window: z.enum(['24h', '7d']),
  totalChecks: z.number(),
  failedChecks: z.number(),
  uptimePercent: z.number().nullable(),
  avgResponseTimeMs: z.number().nullable(),
  minResponseTimeMs: z.number().nullable(),
  maxResponseTimeMs: z.number().nullable(),
  p50ResponseTimeMs: z.number().nullable(),
  p95ResponseTimeMs: z.number().nullable(),
  p99ResponseTimeMs: z.number().nullable(),
});
const seriesResponse = z.object({
  window: z.enum(['24h', '7d']),
  bucketMinutes: z.number(),
  buckets: z.array(
    z.object({
      start: z.string(),
      total: z.number(),
      failed: z.number(),
      avgResponseTimeMs: z.number().nullable(),
      p95ResponseTimeMs: z.number().nullable(),
    }),
  ),
});
const genericResponse = z.record(z.string(), z.unknown());
const authenticated: Record<string, string[]>[] = [{ bearerAuth: [] }];

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Check service health',
  responses: {
    200: { description: 'Postgres is reachable; Redis and queue status are included.' },
    503: { description: 'Postgres is unavailable.' },
  },
});

for (const [path, summary] of [
  ['/api/auth/register', 'Register an account'],
  ['/api/auth/login', 'Log in'],
] as const) {
  registry.registerPath({
    method: 'post',
    path,
    tags: ['Auth'],
    summary,
    request: { body: { content: { 'application/json': { schema: credentialsSchema } } } },
    responses: {
      200: {
        description: 'Authenticated session.',
        content: { 'application/json': { schema: authResponse } },
      },
      201: {
        description: 'Account created.',
        content: { 'application/json': { schema: authResponse } },
      },
      400: {
        description: 'Invalid request.',
        content: { 'application/json': { schema: errorResponse } },
      },
      401: {
        description: 'Invalid credentials.',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
  });
}

for (const path of ['/api/auth/refresh', '/api/auth/logout'] as const) {
  registry.registerPath({
    method: 'post',
    path,
    tags: ['Auth'],
    summary: path.endsWith('refresh') ? 'Rotate the browser refresh token' : 'Log out',
    description: 'Browser-only endpoint that uses the httpOnly refresh cookie.',
    responses: {
      200: { description: 'Request completed.' },
      204: { description: 'Session ended.' },
    },
  });
}
registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  tags: ['Auth'],
  summary: 'Get the current user',
  security: authenticated,
  responses: { 200: { description: 'Current user.' }, 401: { description: 'Unauthorized.' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/monitors',
  tags: ['Monitors'],
  summary: 'List monitors',
  security: authenticated,
  responses: {
    200: {
      description: 'Owned monitors.',
      content: { 'application/json': { schema: monitorsResponse } },
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/monitors',
  tags: ['Monitors'],
  summary: 'Create a monitor',
  security: authenticated,
  request: { body: { content: { 'application/json': { schema: createMonitorSchema } } } },
  responses: {
    201: {
      description: 'Monitor created.',
      content: { 'application/json': { schema: monitorResponse } },
    },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/monitors/{id}',
  tags: ['Monitors'],
  summary: 'Get a monitor',
  security: authenticated,
  request: { params: idParams },
  responses: {
    200: {
      description: 'Owned monitor.',
      content: { 'application/json': { schema: monitorResponse } },
    },
  },
});
registry.registerPath({
  method: 'patch',
  path: '/api/monitors/{id}',
  tags: ['Monitors'],
  summary: 'Update a monitor',
  security: authenticated,
  request: {
    params: idParams,
    body: { content: { 'application/json': { schema: patchMonitorSchema } } },
  },
  responses: {
    200: {
      description: 'Updated monitor.',
      content: { 'application/json': { schema: monitorResponse } },
    },
  },
});
registry.registerPath({
  method: 'delete',
  path: '/api/monitors/{id}',
  tags: ['Monitors'],
  summary: 'Delete a monitor',
  security: authenticated,
  request: { params: idParams },
  responses: { 204: { description: 'Monitor deleted.' } },
});
registry.registerPath({
  method: 'get',
  path: '/api/monitors/{id}/results',
  tags: ['Results and stats'],
  summary: 'List check results',
  security: authenticated,
  request: { params: idParams },
  responses: {
    200: { description: 'Check history.', content: { 'application/json': { schema: resultList } } },
  },
});
for (const [path, summary, response] of [
  ['/api/monitors/{id}/stats', 'Get monitor statistics', statsResponse],
  ['/api/monitors/{id}/timeseries', 'Get monitor time series', seriesResponse],
] as const) {
  registry.registerPath({
    method: 'get',
    path,
    tags: ['Results and stats'],
    summary,
    security: authenticated,
    request: {
      params: idParams,
      query: z.object({ window: z.enum(['24h', '7d']).default('24h') }).strict(),
    },
    responses: {
      200: {
        description: 'Statistics use successful checks for latency percentiles.',
        content: { 'application/json': { schema: response } },
      },
    },
  });
}
registry.registerPath({
  method: 'post',
  path: '/api/monitors/{id}/check',
  tags: ['Monitors'],
  summary: 'Run a manual check',
  security: authenticated,
  request: { params: idParams },
  responses: {
    200: { description: 'Check result.', content: { 'application/json': { schema: idResult } } },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/system/pipeline',
  tags: ['System'],
  summary: 'Get pipeline status',
  security: authenticated,
  responses: { 200: { description: 'Current pipeline health.' } },
});
registry.registerPath({
  method: 'get',
  path: '/api/incidents',
  tags: ['Incidents'],
  summary: 'List incidents',
  security: authenticated,
  request: { query: incidentQuerySchema },
  responses: {
    200: {
      description: 'Owned incidents.',
      content: { 'application/json': { schema: incidentResponse } },
    },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/channels',
  tags: ['Channels'],
  summary: 'List notification channels',
  security: authenticated,
  responses: {
    200: {
      description: 'Owned channels and available types.',
      content: { 'application/json': { schema: channelsResponse } },
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/channels',
  tags: ['Channels'],
  summary: 'Create a notification channel',
  security: authenticated,
  request: { body: { content: { 'application/json': { schema: createChannelSchema } } } },
  responses: {
    201: {
      description: 'Channel created with a masked target.',
      content: { 'application/json': { schema: channelCreateResponse } },
    },
  },
});
registry.registerPath({
  method: 'patch',
  path: '/api/channels/{id}',
  tags: ['Channels'],
  summary: 'Update a notification channel',
  security: authenticated,
  request: {
    params: channelIdSchema,
    body: { content: { 'application/json': { schema: updateChannelSchema } } },
  },
  responses: {
    200: {
      description: 'Channel updated.',
      content: { 'application/json': { schema: channelResponse } },
    },
  },
});
registry.registerPath({
  method: 'delete',
  path: '/api/channels/{id}',
  tags: ['Channels'],
  summary: 'Delete a notification channel',
  security: authenticated,
  request: { params: channelIdSchema },
  responses: { 204: { description: 'Channel removed; notification history remains.' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/channels/{id}/test',
  tags: ['Channels'],
  summary: 'Queue a channel test notification',
  security: authenticated,
  request: { params: channelIdSchema },
  responses: { 202: { description: 'Test notification queued.' } },
});
registry.registerPath({
  method: 'get',
  path: '/api/notifications',
  tags: ['Notifications'],
  summary: 'List notification history',
  security: authenticated,
  request: { query: notificationQuerySchema },
  responses: {
    200: {
      description: 'Owned notification history.',
      content: { 'application/json': { schema: notificationsResponse } },
    },
  },
});

registry.register('Error', errorResponse);
registry.register('GenericResponse', genericResponse);
