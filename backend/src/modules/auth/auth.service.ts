import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { generateRefreshToken, hashToken } from '../../lib/tokens.js';

const dummyHash = bcrypt.hashSync('dummy-password-for-timing', 4);

export async function createSession(userId: string) {
  const raw = generateRefreshToken();
  const familyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400000);
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)',
    [userId, familyId, hashToken(raw), expiresAt]
  );
  return { raw, familyId };
}

export async function register(email: string, password: string) {
  const cleanEmail = email.trim();
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
  try {
    const result = await pool.query(
      'INSERT INTO users (email,password_hash) VALUES ($1,$2) RETURNING id,email',
      [cleanEmail, passwordHash]
    );
    const user = result.rows[0];
    const session = await createSession(user.id);
    return { user, session };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      throw new AppError(409, 'EMAIL_TAKEN', 'Email is already registered');
    }
    throw error;
  }
}

export async function login(email: string, password: string) {
  const result = await pool.query(
    'SELECT id,email,password_hash FROM users WHERE lower(email) = lower($1)',
    [email.trim()]
  );
  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user?.password_hash ?? dummyHash);
  if (!user || !valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  const session = await createSession(user.id);
  return { user: { id: user.id, email: user.email }, session };
}

export async function rotateRefreshToken(raw: string) {
  const hash = hashToken(raw);
  const found = await pool.query(
    'SELECT id,user_id,family_id,expires_at,revoked_at FROM refresh_tokens WHERE token_hash=$1',
    [hash]
  );
  const token = found.rows[0];
  if (!token || token.revoked_at || new Date(token.expires_at).getTime() <= Date.now()) {
    if (token?.family_id) {
      await pool.query('UPDATE refresh_tokens SET revoked_at=now() WHERE family_id=$1 AND revoked_at IS NULL', [token.family_id]);
    }
    throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
  }
  await pool.query('UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1', [token.id]);
  const next = generateRefreshToken();
  await pool.query(
    'INSERT INTO refresh_tokens (user_id,family_id,token_hash,expires_at) VALUES ($1,$2,$3,$4)',
    [token.user_id, token.family_id, hashToken(next), new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400000)]
  );
  return { raw: next, userId: token.user_id };
}

export async function revokeFamilyByToken(raw: string): Promise<void> {
  const found = await pool.query(
    'SELECT family_id FROM refresh_tokens WHERE token_hash=$1',
    [hashToken(raw)]
  );
  if (found.rows[0]?.family_id) {
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at=now() WHERE family_id=$1 AND revoked_at IS NULL',
      [found.rows[0].family_id]
    );
  }
}

export async function getUserById(userId: string) {
  const result = await pool.query('SELECT id,email FROM users WHERE id=$1', [userId]);
  return result.rows[0] ?? null;
}
