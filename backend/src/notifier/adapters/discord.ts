import { renderNotification, type NotificationPayload } from '../render.js';

export function discordBody(
  type: 'incident.opened' | 'incident.resolved' | 'test',
  payload: NotificationPayload,
): string {
  const message = renderNotification(type, payload);
  return JSON.stringify({
    embeds: [
      {
        title: message.title,
        description: message.body,
        color: Number.parseInt(message.color.slice(1), 16),
      },
    ],
    allowed_mentions: { parse: [] },
  });
}
