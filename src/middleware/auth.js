import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import * as userRepository from '../repositories/userRepository.js';

/**
 * Verifies the Bearer access token and loads the current user with their permissions.
 * The user is re-read on every request so deactivation or permission changes apply immediately.
 */
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw ApiError.unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token';
    throw new ApiError(
      401,
      err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED',
      message,
    );
  }

  const user = await userRepository.findAuthUserById(Number(payload.sub));
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Account is inactive or no longer exists');
  }

  req.user = user;
  req.context = {
    userId: user.id,
    ip: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 255),
  };
  next();
}
