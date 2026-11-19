import { env } from '../../config/env.js';
import { escapeHtml, renderNotification, type NotificationPayload } from '../render.js';

export async function sendEmail(
  type: 'incident.opened' | 'incident.resolved' | 'test',
  payload: NotificationPayload,
  recipient: string,
): Promise<{ statusCode: number; retryAfter: string | null }> {
  if (env.EMAIL_PROVIDER !== 'resend' || !env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error('Email provider is not configured.');
  }
  const message = renderNotification(type, payload);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [recipient],
      subject: `[Watcher] ${message.title}`,
      text: message.body,
      html: `<h1>${escapeHtml(message.title)}</h1><p>${escapeHtml(message.body).replace(/\n/g, '<br>')}</p>`,
    }),
    signal: AbortSignal.timeout(env.NOTIFY_TIMEOUT_MS),
  });
  return {
    statusCode: response.status,
    retryAfter: response.headers.get('retry-after'),
  };
}
