import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '../lib/crypto.js';
import { discordBody } from './adapters/discord.js';
import { slackBody } from './adapters/slack.js';
import { webhookRequest } from './adapters/webhook.js';
import { escapeHtml, escapeSlack, formatDuration, renderNotification } from './render.js';

describe('notification rendering', () => {
  it('formats durations and escapes Slack and email text', () => {
    expect(formatDuration(90)).toBe('1 min 30 s');
    expect(escapeSlack('& < >')).toBe('&amp; &lt; &gt;');
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');

    const body = slackBody('incident.opened', {
      monitor: { id: 'monitor-id', name: '<Payments>', url: 'https://example.com' },
      incident: {
        id: 'incident-id',
        startedAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        durationSeconds: null,
        failedChecks: 3,
      },
      check: { statusCode: 503, error: 'bad <response>', responseTimeMs: null },
    });
    expect(JSON.parse(body).attachments[0].text).toContain('&lt;Payments&gt;');
    expect(JSON.parse(body).attachments[0].text).toContain('bad &lt;response&gt;');
  });

  it('keeps mentions disabled in Discord payloads and signs the exact webhook body', () => {
    const payload = {
      title: 'Test notification',
      body: 'Safe test',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const discord = JSON.parse(discordBody('test', payload));
    expect(discord.allowed_mentions).toEqual({ parse: [] });

    const timestamp = 1_800_000_000;
    const notification = webhookRequest('test', 'delivery-id', payload, 'test-secret', timestamp);
    expect(
      verifyWebhookSignature(
        'test-secret',
        timestamp,
        notification.body,
        notification.headers['x-watcher-signature'],
        timestamp,
      ),
    ).toBe(true);

    expect(renderNotification('test', payload).title).toBe('Test notification from Watcher');
  });
});
