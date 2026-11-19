import { describe, expect, it } from 'vitest';
import { checkResultEventSchema } from './event.js';

const valid = {
  schemaVersion: 1,
  eventId: '6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a11',
  monitorId: '6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a12',
  checkedAt: '2026-01-01T10:00:00.000Z',
  status: 'up',
  statusCode: 200,
  responseTimeMs: 142,
  error: null,
  source: 'scheduler',
};

describe('CheckResultEvent schema', () => {
  it('accepts a valid event', () =>
    expect(checkResultEventSchema.parse(valid)).toMatchObject(valid));
  it('rejects unknown fields', () =>
    expect(checkResultEventSchema.safeParse({ ...valid, secret: 'x' }).success).toBe(false));
  it('rejects unsupported version and malformed ids', () => {
    expect(checkResultEventSchema.safeParse({ ...valid, schemaVersion: 2 }).success).toBe(false);
    expect(checkResultEventSchema.safeParse({ ...valid, eventId: 'not-a-uuid' }).success).toBe(
      false,
    );
    expect(checkResultEventSchema.safeParse({ ...valid, monitorId: 'not-a-uuid' }).success).toBe(
      false,
    );
  });
});
