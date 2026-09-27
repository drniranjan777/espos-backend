import bcrypt from 'bcryptjs';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import * as refreshTokenRepository from '../repositories/refreshTokenRepository.js';
import * as userRepository from '../repositories/userRepository.js';
import { ApiError } from '../utils/ApiError.js';
import {
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../utils/tokens.js';
import * as auditService from './auditService.js';

// Compared against when the user does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('invalid-password-placeholder', 10);

const INVALID_CREDENTIALS = 'Invalid username or password';

async function issueSession(userId, context, trx) {
  const refreshToken = generateRefreshToken();
  const expiresAt = refreshTokenExpiry();
  await refreshTokenRepository.create(
    {
      user_id: userId,
      token_hash: hashToken(refreshToken),
      expires_at: expiresAt,
      ip: context.ip ?? null,
      user_agent: context.userAgent ?? null,
    },
    trx,
  );
  const user = await userRepository.findAuthUserById(userId);
  return { accessToken: signAccessToken(user), refreshToken, refreshExpiresAt: expiresAt, user };
}

export async function login({ login, password }, context) {
  const user = await userRepository.findForLogin(login);
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordOk) throw new ApiError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
  if (!user.isActive) throw new ApiError(403, 'ACCOUNT_DISABLED', 'Your account has been disabled');

  const session = await issueSession(user.id, context);
  await userRepository.touchLastLogin(user.id);
  await auditService.log(
    { ...context, userId: user.id },
    { action: AUDIT_ACTION.LOGIN, module: AUDIT_MODULE.AUTH, recordId: user.id },
  );
  return session;
}

/**
 * Rotates a refresh token. Presenting an already-revoked token is treated as token theft:
 * every session of that user is revoked.
 */
export async function refresh(rawToken, context) {
  if (!rawToken) throw ApiError.unauthorized('Session expired');

  return db.transaction(async (trx) => {
    const stored = await refreshTokenRepository.findByHash(hashToken(rawToken), trx);
    if (!stored) throw ApiError.unauthorized('Session expired');

    if (stored.revoked_at) {
      await refreshTokenRepository.revokeAllForUser(stored.user_id, trx);
      throw ApiError.unauthorized('Session expired');
    }
    if (new Date(stored.expires_at) <= new Date()) throw ApiError.unauthorized('Session expired');

    const user = await userRepository.findById(stored.user_id, trx);
    if (!user?.isActive) throw ApiError.unauthorized('Account is inactive');

    await refreshTokenRepository.revoke(stored.id, trx);
    return issueSession(stored.user_id, context, trx);
  });
}

export async function logout(rawToken, context) {
  if (!rawToken) return;
  const stored = await db('refresh_tokens').where({ token_hash: hashToken(rawToken) }).first();
  if (!stored) return;
  await refreshTokenRepository.revoke(stored.id);
  await auditService.log(
    { ...context, userId: stored.user_id },
    { action: AUDIT_ACTION.LOGOUT, module: AUDIT_MODULE.AUTH, recordId: stored.user_id },
  );
}

export async function changePassword(userId, { currentPassword, newPassword }, context) {
  const hash = await userRepository.findPasswordHash(userId);
  if (!hash || !(await bcrypt.compare(currentPassword, hash))) {
    throw ApiError.badRequest('Current password is incorrect');
  }
  await db.transaction(async (trx) => {
    await userRepository.update(
      userId,
      { password_hash: await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS), updated_by: userId },
      trx,
    );
    // Sign out other devices.
    await refreshTokenRepository.revokeAllForUser(userId, trx);
    await auditService.log(
      context,
      { action: AUDIT_ACTION.PASSWORD_CHANGE, module: AUDIT_MODULE.AUTH, recordId: userId },
      trx,
    );
  });
}
