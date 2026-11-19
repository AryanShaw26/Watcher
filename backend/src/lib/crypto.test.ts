import { describe, expect, it } from 'vitest';
import {
  decrypt,
  encrypt,
  maskEmail,
  maskTarget,
  signWebhook,
  verifyWebhookSignature,
} from './crypto.js';

describe('channel cryptography', () => {
  it('round-trips values with a fresh authenticated envelope each time', () => {
    const first = encrypt('https://hooks.example.test/secret');
    const second = encrypt('https://hooks.example.test/secret');

    expect(first).toMatch(/^v1:/);
    expect(first).not.toBe(second);
    expect(decrypt(first)).toBe('https://hooks.example.test/secret');
  });

  it('rejects tampering and unknown versions', () => {
    const value = encrypt('secret');
    const data = Buffer.from(value.slice(3), 'base64');
    data[data.length - 1] ^= 1;

    expect(() => decrypt(`v1:${data.toString('base64')}`)).toThrow();
    expect(() => decrypt('v2:opaque')).toThrow(/version/i);
  });

  it('masks targets and account email addresses', () => {
    expect(maskTarget('https://hooks.slack.com/services/TEAM/HOOK/abcd1234')).toBe(
      'hooks.slack.com/…1234',
    );
    expect(maskEmail('alerts@example.com')).toBe('a***@example.com');
  });
});

describe('webhook signatures', () => {
  it('verifies the raw body and rejects changes and stale timestamps', () => {
    const timestamp = 1_800_000_000;
    const body = '{"event":"incident.opened"}';
    const signature = signWebhook('test-secret', timestamp, body);

    expect(verifyWebhookSignature('test-secret', timestamp, body, signature, timestamp)).toBe(true);
    expect(verifyWebhookSignature('test-secret', timestamp, `${body} `, signature, timestamp)).toBe(
      false,
    );
    expect(verifyWebhookSignature('test-secret', timestamp - 301, body, signature, timestamp)).toBe(
      false,
    );
  });
});
