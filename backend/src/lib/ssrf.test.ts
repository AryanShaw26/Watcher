import { describe, expect, it } from 'vitest';
import { assertPublicUrl, parsePublicUrl } from './ssrf.js';

describe('SSRF URL validation', () => {
  it('rejects private and unsafe targets', async () => {
    for (const url of [
      'http://localhost',
      'http://127.0.0.1',
      'http://169.254.169.254',
      'http://10.0.0.1',
      'http://[::1]',
      'http://[::ffff:127.0.0.1]',
      'ftp://x',
      'http://user:pass@example.com',
    ]) {
      await expect(assertPublicUrl(url)).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
    }
  });

  it('accepts a public HTTPS URL', () => {
    expect(parsePublicUrl('https://example.com').hostname).toBe('example.com');
  });
});
