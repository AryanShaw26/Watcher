import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../config/env.js';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encryptionKey(): Buffer {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return key;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')}`;
}

export function decrypt(stored: string): string {
  if (!stored.startsWith('v1:')) throw new Error('Unsupported encrypted value version.');
  const data = Buffer.from(stored.slice(3), 'base64');
  if (data.length < IV_LENGTH + TAG_LENGTH) throw new Error('Invalid encrypted value.');

  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function signWebhook(secret: string, timestamp: number | string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: number | string,
  rawBody: string,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const parsedTimestamp = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (!Number.isInteger(parsedTimestamp) || Math.abs(nowSeconds - parsedTimestamp) > 300)
    return false;
  const expected = Buffer.from(signWebhook(secret, parsedTimestamp, rawBody).slice(7), 'hex');
  const supplied = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function maskTarget(target: string): string {
  const url = new URL(target);
  const path = url.pathname.replace(/\/+$/, '');
  const suffix = path.slice(-4);
  return `${url.host}/…${suffix}`;
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
