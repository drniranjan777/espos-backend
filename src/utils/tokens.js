import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signAccessToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.roleName }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });
}

export function generateRefreshToken() {
  return randomBytes(48).toString('base64url');
}

/** Refresh tokens are stored hashed so a database leak does not expose live sessions. */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry() {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
