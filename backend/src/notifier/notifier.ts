import pLimit from 'p-limit';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { redis, redisKey } from '../redis/client.js';
import {
  deliverNotification,
  type DeliveryResponse,
  type NotificationForDelivery,
} from './deliver.js';

type ClaimedNotification = NotificationForDelivery & {
  attempts: number;
  status: 'sending';
  locked_until: Date;
};

async function claimNotifications(): Promise<ClaimedNotification[]> {
  const result = await pool.query<ClaimedNotification>(
    `UPDATE notifications
     SET status='sending',attempts=attempts+1,locked_until=now()+interval '60 seconds'
     WHERE id IN (
       SELECT id FROM notifications
       WHERE (status='pending' AND next_attempt_at<=now())
          OR (status='sending' AND (locked_until IS NULL OR locked_until<now()))
       ORDER BY next_attempt_at,created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [env.NOTIFY_BATCH_SIZE],
  );
  return result.rows;
}

async function suppress(notification: ClaimedNotification, reason: string): Promise<void> {
  await pool.query(
    `UPDATE notifications SET status='suppressed',last_error=$2,locked_until=NULL
     WHERE id=$1`,
    [notification.id, reason],
  );
  logger.info(
    {
      notificationId: notification.id,
      type: notification.type,
      channelType: notification.channel_type,
      status: 'suppressed',
      attempt: notification.attempts,
    },
    'Notification attempt completed',
  );
}

function retryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) ? seconds : (Date.parse(header) - Date.now()) / 1000;
  return Number.isFinite(delay) ? Math.min(900, Math.max(0, Math.ceil(delay))) : null;
}

function backoffSeconds(attempt: number): number {
  const values = env.NOTIFY_BACKOFF_SECONDS;
  return values[Math.min(Math.max(0, attempt - 1), values.length - 1)];
}

async function storeOutcome(
  notification: ClaimedNotification,
  response: DeliveryResponse | { permanentError?: string; retryableError?: string },
): Promise<void> {
  if ('permanentError' in response && response.permanentError) {
    if (response.permanentError === 'Channel removed or disabled') {
      await suppress(notification, response.permanentError);
      return;
    }
    await pool.query(
      `UPDATE notifications SET status='failed',last_error=$2,locked_until=NULL
       WHERE id=$1`,
      [notification.id, response.permanentError],
    );
    logger.info(
      {
        notificationId: notification.id,
        type: notification.type,
        channelType: notification.channel_type,
        status: 'failed',
        attempt: notification.attempts,
      },
      'Notification attempt completed',
    );
    return;
  }

  if ('retryableError' in response && response.retryableError) {
    await retryOrFail(notification, response.retryableError);
    return;
  }

  const result = response as DeliveryResponse;
  if (result.statusCode >= 200 && result.statusCode < 300) {
    await pool.query(
      `UPDATE notifications SET status='sent',sent_at=now(),last_error=NULL,locked_until=NULL
       WHERE id=$1`,
      [notification.id],
    );
    logger.info(
      {
        notificationId: notification.id,
        type: notification.type,
        channelType: notification.channel_type,
        status: 'sent',
        attempt: notification.attempts,
      },
      'Notification attempt completed',
    );
    return;
  }

  const error = `HTTP ${result.statusCode}`;
  if (result.statusCode === 429 || result.statusCode >= 500) {
    const retrySeconds =
      result.statusCode === 429
        ? (retryAfterSeconds(result.retryAfter) ?? backoffSeconds(notification.attempts))
        : backoffSeconds(notification.attempts);
    await retryOrFail(notification, error, retrySeconds);
    return;
  }

  await pool.query(
    `UPDATE notifications SET status='failed',last_error=$2,locked_until=NULL
     WHERE id=$1`,
    [notification.id, error],
  );
  logger.info(
    {
      notificationId: notification.id,
      type: notification.type,
      channelType: notification.channel_type,
      status: 'failed',
      attempt: notification.attempts,
    },
    'Notification attempt completed',
  );
}

async function retryOrFail(
  notification: ClaimedNotification,
  error: string,
  delaySeconds = backoffSeconds(notification.attempts),
): Promise<void> {
  const isFinal = notification.attempts >= env.NOTIFY_MAX_ATTEMPTS;
  await pool.query(
    `UPDATE notifications
     SET status=$2,last_error=$3,
         next_attempt_at=CASE WHEN $2='pending' THEN now()+($4 || ' seconds')::interval ELSE next_attempt_at END,
         locked_until=NULL
     WHERE id=$1`,
    [notification.id, isFinal ? 'failed' : 'pending', error.slice(0, 120), delaySeconds],
  );
  logger.info(
    {
      notificationId: notification.id,
      type: notification.type,
      channelType: notification.channel_type,
      status: isFinal ? 'failed' : 'pending',
      attempt: notification.attempts,
    },
    'Notification attempt completed',
  );
}

async function processClaimed(notification: ClaimedNotification): Promise<void> {
  const channel = notification.channel_id
    ? await pool.query(
        'SELECT id,is_active FROM notification_channels WHERE id=$1 AND user_id=$2',
        [notification.channel_id, notification.user_id],
      )
    : { rows: [] };
  if (!channel.rows[0] || !channel.rows[0].is_active) {
    await suppress(notification, 'Channel removed or disabled');
    return;
  }

  if (notification.type === 'incident.resolved') {
    const opened = await pool.query(
      `SELECT 1 FROM notifications
       WHERE incident_id=$1 AND channel_id=$2 AND type='incident.opened' AND status='sent'`,
      [notification.incident_id, notification.channel_id],
    );
    if (!opened.rowCount) {
      await suppress(notification, 'No alert was sent for the start of this incident');
      return;
    }
  }

  if (notification.type === 'incident.opened') {
    try {
      const result = await redis.set(
        redisKey(`alert:cooldown:${notification.monitor_id}:${notification.channel_id}`),
        '1',
        'EX',
        env.ALERT_COOLDOWN_SECONDS,
        'NX',
      );
      if (result !== 'OK') {
        await suppress(notification, 'Within cooldown after a recent alert');
        return;
      }
    } catch {
      logger.warn(
        { notificationId: notification.id },
        'Alert cooldown unavailable; sending notification',
      );
    }
  }

  const count = await pool.query(
    `SELECT count(*)::int AS count FROM notifications
     WHERE channel_id=$1 AND status='sent' AND type<>'test'
       AND sent_at >= now()-interval '1 hour'`,
    [notification.channel_id],
  );
  if (Number(count.rows[0].count) >= env.NOTIFY_MAX_PER_CHANNEL_PER_HOUR) {
    await suppress(notification, 'Hourly limit reached for this channel');
    return;
  }

  await storeOutcome(notification, await deliverNotification(notification));
}

export async function processDueNotifications(): Promise<void> {
  const rows = await claimNotifications();
  const limit = pLimit(5);
  await Promise.all(rows.map((notification) => limit(() => processClaimed(notification))));
}

export function startNotifier(): () => Promise<void> {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let active = Promise.resolve();

  const tick = async () => {
    if (stopped) return;
    active = processDueNotifications().catch((error: unknown) => {
      logger.error({ error }, 'Notifier batch failed');
    });
    await active;
    if (!stopped) {
      timer = setTimeout(() => void tick(), env.NOTIFIER_TICK_SECONDS * 1000);
      timer.unref();
    }
  };
  void tick();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await Promise.race([active, new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
  };
}
