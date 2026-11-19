import { describe, expect, it } from 'vitest';
import request from 'supertest';
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildApp } from '../app.js';
import { openapi } from './openapi.js';

describe('OpenAPI and Swagger UI', () => {
  it('generates a valid spec with the V3 endpoints and auth schemes', async () => {
    const spec: Parameters<typeof SwaggerParser.validate>[0] = JSON.parse(JSON.stringify(openapi));
    await expect(SwaggerParser.validate(spec)).resolves.toBeDefined();
    expect(openapi.paths['/api/incidents']).toBeDefined();
    expect(openapi.paths['/api/channels']).toBeDefined();
    expect(openapi.paths['/api/monitors/{id}/timeseries']).toBeDefined();
    expect(openapi.components?.securitySchemes).toMatchObject({
      bearerAuth: { type: 'http', scheme: 'bearer' },
      apiKeyAuth: { type: 'apiKey', name: 'X-API-Key' },
    });
    expect(openapi.paths['/api/monitors']?.get?.security).toEqual([{ bearerAuth: [] }]);
  });

  it('serves Swagger UI with a route-local CSP and retains the strict API CSP', async () => {
    const app = buildApp();
    const docs = await request(app).get('/api/docs/');
    const api = await request(app).get('/api/monitors');

    expect(docs.status).toBe(200);
    expect(docs.headers['content-type']).toContain('text/html');
    expect(docs.headers['content-security-policy']).toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(api.headers['content-security-policy']).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
