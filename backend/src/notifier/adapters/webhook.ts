import { signWebhook } from '../../lib/crypto.js';
import type { NotificationPayload } from '../render.js';

export function webhookRequest(
  type: 'incident.opened' | 'incident.resolved' | 'test',
  notificationId: string,
  payload: NotificationPayload,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const sentAt = new Date(timestamp * 1000).toISOString();
  const body = JSON.stringify({
    event: type,
    deliveryId: notificationId,
    sentAt,
    monitor: payload.monitor ?? null,
    incident: payload.incident ?? null,
    check: payload.check ?? null,
    ...(type === 'test' ? { title: payload.title, body: payload.body } : {}),
  });
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'WatcherBot/1.0 (+uptime-monitor)',
      'x-watcher-event': type,
      'x-watcher-delivery': notificationId,
      'x-watcher-timestamp': String(timestamp),
      'x-watcher-signature': signWebhook(secret, timestamp, body),
    },
  };
}
