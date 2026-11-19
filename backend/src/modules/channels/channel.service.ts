import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { decrypt, encrypt, maskEmail, maskTarget } from '../../lib/crypto.js';
import { assertPublicUrl, parsePublicUrl } from '../../lib/ssrf.js';

type ChannelType = 'webhook' | 'slack' | 'discord' | 'email';
type ChannelInput = { type: ChannelType; name: string; url?: string };
type ChannelPatch = { name?: string; isActive?: boolean; url?: string };

function availableTypes(): ChannelType[] {
  return env.EMAIL_PROVIDER === 'resend'
    ? ['slack', 'discord', 'webhook', 'email']
    : ['slack', 'discord', 'webhook'];
}

function assertChannelTypeAvailable(type: ChannelType): void {
  if (!availableTypes().includes(type)) {
    throw new AppError(
      400,
      'CHANNEL_TYPE_UNAVAILABLE',
      "Email alerts aren't available on this server.",
    );
  }
}

async function validateChannelUrl(type: Exclude<ChannelType, 'email'>, raw: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = env.ALLOW_PRIVATE_TARGETS ? new URL(raw) : parsePublicUrl(raw);
  } catch {
    throw new AppError(400, 'URL_NOT_ALLOWED', 'Channel URL is not allowed.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(400, 'URL_NOT_ALLOWED', 'Channel URL must use http or https.');
  }
  if (parsed.username || parsed.password) {
    throw new AppError(400, 'URL_NOT_ALLOWED', 'Channel URLs cannot contain credentials.');
  }
  if (type === 'webhook') {
    if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      throw new AppError(400, 'URL_NOT_ALLOWED', 'Webhook URLs must use https in production.');
    }
    if (parsed.protocol !== 'https:' && !env.ALLOW_PRIVATE_TARGETS) {
      throw new AppError(400, 'URL_NOT_ALLOWED', 'Webhook URLs must use https.');
    }
  } else {
    const validSlack =
      type === 'slack' &&
      parsed.hostname.toLowerCase() === 'hooks.slack.com' &&
      parsed.pathname.startsWith('/services/');
    const validDiscord =
      type === 'discord' &&
      ['discord.com', 'discordapp.com'].includes(parsed.hostname.toLowerCase()) &&
      parsed.pathname.startsWith('/api/webhooks/');
    if (!validSlack && !validDiscord) {
      throw new AppError(400, 'VALIDATION_ERROR', `Invalid ${type} webhook host or path.`);
    }
    if (parsed.protocol !== 'https:') {
      throw new AppError(400, 'URL_NOT_ALLOWED', 'Chat webhook URLs must use https.');
    }
  }
  await assertPublicUrl(raw);
}

async function accountEmail(userId: string): Promise<string> {
  const result = await pool.query('SELECT email FROM users WHERE id=$1', [userId]);
  if (!result.rows[0]) throw new AppError(404, 'NOT_FOUND', 'User not found');
  return result.rows[0].email as string;
}

function mapChannel(row: Record<string, unknown>, email?: string) {
  const target =
    row.type === 'email'
      ? email
      : row.target_encrypted
        ? decrypt(String(row.target_encrypted))
        : null;
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    isActive: row.is_active,
    maskedTarget: target ? (row.type === 'email' ? maskEmail(target) : maskTarget(target)) : null,
    createdAt: row.created_at,
  };
}

export async function listChannels(userId: string) {
  const [channels, email] = await Promise.all([
    pool.query(
      'SELECT id,type,name,is_active,target_encrypted,created_at FROM notification_channels WHERE user_id=$1 ORDER BY created_at DESC',
      [userId],
    ),
    accountEmail(userId),
  ]);
  return {
    channels: channels.rows.map((row) => mapChannel(row, email)),
    availableTypes: availableTypes(),
  };
}

export async function createChannel(userId: string, input: ChannelInput) {
  assertChannelTypeAvailable(input.type);
  const count = await pool.query(
    'SELECT count(*)::int AS count FROM notification_channels WHERE user_id=$1',
    [userId],
  );
  if (count.rows[0].count >= env.MAX_CHANNELS_PER_USER) {
    throw new AppError(
      409,
      'CHANNEL_LIMIT_REACHED',
      "You've reached the limit of 5 channels. Delete one to add another.",
    );
  }

  if (input.type !== 'email') await validateChannelUrl(input.type, input.url!);
  const targetEncrypted = input.url ? encrypt(input.url) : null;
  const signingSecret =
    input.type === 'webhook' ? `whsec_${randomBytes(32).toString('base64url')}` : null;
  const secretEncrypted = signingSecret ? encrypt(signingSecret) : null;
  const inserted = await pool.query(
    `INSERT INTO notification_channels
       (user_id,type,name,target_encrypted,signing_secret_encrypted)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id,type,name,is_active,target_encrypted,created_at`,
    [userId, input.type, input.name, targetEncrypted, secretEncrypted],
  );
  const email = input.type === 'email' ? await accountEmail(userId) : undefined;
  return {
    channel: mapChannel(inserted.rows[0], email),
    ...(signingSecret ? { signingSecret } : {}),
  };
}

export async function updateChannel(userId: string, id: string, patch: ChannelPatch) {
  const current = await pool.query(
    `SELECT id,type,target_encrypted FROM notification_channels WHERE id=$1 AND user_id=$2`,
    [id, userId],
  );
  const row = current.rows[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Channel not found');
  if (patch.url !== undefined && row.type === 'email') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email channels do not accept a URL.');
  }
  if (patch.url !== undefined) await validateChannelUrl(row.type, patch.url);

  const fields: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    fields.push(`${column}=$${values.length + 1}`);
    values.push(value);
  };
  if (patch.name !== undefined) add('name', patch.name);
  if (patch.isActive !== undefined) add('is_active', patch.isActive);
  if (patch.url !== undefined) add('target_encrypted', encrypt(patch.url));
  fields.push('updated_at=now()');
  values.push(id, userId);

  const updated = await pool.query(
    `UPDATE notification_channels SET ${fields.join(',')}
     WHERE id=$${values.length - 1} AND user_id=$${values.length}
     RETURNING id,type,name,is_active,target_encrypted,created_at`,
    values,
  );
  const email = row.type === 'email' ? await accountEmail(userId) : undefined;
  return { channel: mapChannel(updated.rows[0], email) };
}

export async function deleteChannel(userId: string, id: string): Promise<void> {
  const result = await pool.query('DELETE FROM notification_channels WHERE id=$1 AND user_id=$2', [
    id,
    userId,
  ]);
  if (!result.rowCount) throw new AppError(404, 'NOT_FOUND', 'Channel not found');
}

export async function queueTestNotification(userId: string, id: string) {
  const channel = await pool.query(
    'SELECT id,type,name,is_active FROM notification_channels WHERE id=$1 AND user_id=$2',
    [id, userId],
  );
  const row = channel.rows[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Channel not found');
  if (!row.is_active) throw new AppError(409, 'CHANNEL_INACTIVE', 'Channel is inactive.');
  const payload = {
    title: 'Test notification from Watcher',
    body: 'This channel is set up correctly.',
    createdAt: new Date().toISOString(),
  };
  const inserted = await pool.query(
    `INSERT INTO notifications
       (user_id,channel_id,channel_type,channel_name,type,payload)
     VALUES ($1,$2,$3,$4,'test',$5::jsonb)
     RETURNING id,type,status,channel_type,channel_name,attempts,last_error,created_at,sent_at`,
    [userId, row.id, row.type, row.name, JSON.stringify(payload)],
  );
  const notification = inserted.rows[0];
  return {
    notification: {
      id: notification.id,
      type: notification.type,
      status: notification.status,
      channelType: notification.channel_type,
      channelName: notification.channel_name,
      monitorName: null,
      incidentId: null,
      attempts: Number(notification.attempts),
      lastError: notification.last_error,
      createdAt: new Date(notification.created_at).toISOString(),
      sentAt: notification.sent_at ? new Date(notification.sent_at).toISOString() : null,
    },
  };
}

export async function getChannelForDelivery(channelId: string) {
  const result = await pool.query(
    `SELECT id,user_id,type,name,target_encrypted,signing_secret_encrypted,is_active
     FROM notification_channels WHERE id=$1`,
    [channelId],
  );
  return result.rows[0] ?? null;
}

export { decrypt };
