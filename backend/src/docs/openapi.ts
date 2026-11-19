import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.js';

const generator = new OpenApiGeneratorV3(registry.definitions);
export const openapi = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'Watcher API',
    version: '3.0.0',
    description:
      'Your APIs. Always in Sight. Checks are delivered at least once and stored idempotently. Incidents and notification outbox rows are committed with check results. Latency percentiles use successful checks with a response time only.',
  },
  tags: [
    { name: 'Auth' },
    { name: 'Monitors' },
    { name: 'Results and stats' },
    { name: 'Incidents' },
    { name: 'Channels' },
    { name: 'Notifications' },
    { name: 'API keys' },
    { name: 'System' },
  ],
});

openapi.components = {
  ...openapi.components,
  securitySchemes: {
    ...openapi.components?.securitySchemes,
    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    apiKeyAuth: {
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
      description:
        'Reserved for the Stretch API-key feature; API-key authentication is not enabled.',
    },
  },
};
