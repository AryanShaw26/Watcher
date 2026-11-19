import { request } from 'undici';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { decrypt } from '../lib/crypto.js';
import { createSafeAgent, assertPublicUrl } from '../lib/ssrf.js';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { getChannelForDelivery } from '../modules/channels/channel.service.js';
import { discordBody } from './adapters/discord.js';
import { sendEmail } from './adapters/email.js';
import { slackBody } from './adapters/slack.js';
import { webhookRequest } from './adapters/webhook.js';
import type { NotificationPayload } from './render.js';

export type NotificationForDelivery = {
  id: string;
  user_id: string;
  channel_id: string | null;
  monitor_id: string | null;
  incident_id: string | null;
  channel_type: 'webhook' | 'slack' | 'discord' | 'email';
  type: 'incident.opened' | 'incident.resolved' | 'test';
  payload: NotificationPayload;
};

export type DeliveryResponse = { statusCode: number; retryAfter: string | null };
export type DeliveryFailure = { permanentError?: string; retryableError?: string };

function isPayload(value: unknown): value is NotificationPayload {
  return typeof value === 'object' && value !== null;
}

export async function deliverNotification(
  notification: NotificationForDelivery,
): Promise<DeliveryResponse | DeliveryFailure> {
  const channel = notification.channel_id
    ? await getChannelForDelivery(notification.channel_id)
    : null;
  if (!channel || !channel.is_active) return { permanentError: 'Channel removed or disabled' };

  const payload = isPayload(notification.payload) ? notification.payload : {};
  if (notification.channel_type === 'email') {
    try {
      const user = await pool.query('SELECT email FROM users WHERE id=$1', [notification.user_id]);
      if (!user.rows[0]) return { permanentError: 'Recipient account not found' };
      return await sendEmail(notification.type, payload, String(user.rows[0].email));
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return {
        retryableError: timedOut
          ? `Timeout after ${env.NOTIFY_TIMEOUT_MS}ms`
          : 'Email provider connection error',
      };
    }
  }

  let target: string;
  try {
    if (!channel.target_encrypted) return { permanentError: 'Channel target is missing' };
    target = decrypt(String(channel.target_encrypted));
    await assertPublicUrl(target);
  } catch (error) {
    logger.error(
      {
        notificationId: notification.id,
        error: error instanceof AppError ? error.code : 'DECRYPTION_ERROR',
      },
      'Notification target could not be validated or decrypted',
    );
    return {
      permanentError: error instanceof AppError ? error.code : 'Decryption error',
    };
  }

  let body: string;
  let headers: Record<string, string>;
  try {
    if (notification.channel_type === 'slack') {
      body = slackBody(notification.type, payload);
      headers = { 'content-type': 'application/json' };
    } else if (notification.channel_type === 'discord') {
      body = discordBody(notification.type, payload);
      headers = { 'content-type': 'application/json' };
    } else {
      if (!channel.signing_secret_encrypted) {
        return { permanentError: 'Webhook signing secret is missing' };
      }
      const secret = decrypt(String(channel.signing_secret_encrypted));
      const signed = webhookRequest(notification.type, notification.id, payload, secret);
      body = signed.body;
      headers = signed.headers;
    }
  } catch {
    logger.error({ notificationId: notification.id }, 'Notification payload could not be prepared');
    return { permanentError: 'Payload preparation failed' };
  }

  const agent = createSafeAgent();
  try {
    const response = await request(target, {
      method: 'POST',
      headers,
      body,
      dispatcher: agent,
      headersTimeout: env.NOTIFY_TIMEOUT_MS,
      bodyTimeout: env.NOTIFY_TIMEOUT_MS,
      signal: AbortSignal.timeout(env.NOTIFY_TIMEOUT_MS),
    });
    const retryAfter = response.headers['retry-after'];
    await response.body.dump();
    return {
      statusCode: response.statusCode,
      retryAfter: Array.isArray(retryAfter) ? (retryAfter[0] ?? null) : (retryAfter ?? null),
    };
  } catch (error) {
    const timedOut = error instanceof Error && /timeout|abort/i.test(error.name);
    return {
      retryableError: timedOut ? `Timeout after ${env.NOTIFY_TIMEOUT_MS}ms` : 'Connection error',
    };
  } finally {
    await agent.close().catch(() => {
      logger.warn(
        { notificationId: notification.id, error: 'Agent close failed' },
        'Delivery agent cleanup failed',
      );
    });
  }
}
