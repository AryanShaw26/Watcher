import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

describe('request IDs', () => {
  it('preserves a valid UUID and includes it in the error body', async () => {
    const requestId = 'c0a801a0-0000-4000-8000-000000000001';
    const response = await request(buildApp()).get('/missing').set('x-request-id', requestId);

    expect(response.status).toBe(404);
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.body.error.requestId).toBe(requestId);
  });

  it('replaces an invalid client ID with a UUID', async () => {
    const response = await request(buildApp()).get('/missing').set('x-request-id', 'not-a-uuid');

    expect(response.status).toBe(404);
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });
});
