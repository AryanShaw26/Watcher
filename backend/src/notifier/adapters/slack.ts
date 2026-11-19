import { escapeSlack, renderNotification, type NotificationPayload } from '../render.js';

export function slackBody(
  type: 'incident.opened' | 'incident.resolved' | 'test',
  payload: NotificationPayload,
): string {
  const message = renderNotification(type, payload);
  return JSON.stringify({
    attachments: [
      {
        color: message.color,
        text: `*${escapeSlack(message.title)}*\n${escapeSlack(message.body)}`,
      },
    ],
  });
}
