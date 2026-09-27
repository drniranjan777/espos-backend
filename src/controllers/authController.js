import { env } from '../config/env.js';
import * as authService from '../services/authService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { anonymousContext } from '../utils/requestContext.js';

export const REFRESH_COOKIE = 'refresh_token';
const COOKIE_PATH = '/api/v1/auth';

function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'strict',
    path: COOKIE_PATH,
    expires: expiresAt,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, httpOnly: true, sameSite: 'strict', secure: env.isProduction });
}

function sessionResponse(res, session) {
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  return sendSuccess(res, { accessToken: session.accessToken, user: session.user });
}

export async function login(req, res) {
  const session = await authService.login(req.validated.body, anonymousContext(req));
  return sessionResponse(res, session);
}

export async function refresh(req, res) {
  try {
    const session = await authService.refresh(req.cookies[REFRESH_COOKIE], anonymousContext(req));
    return sessionResponse(res, session);
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
}

export async function logout(req, res) {
  await authService.logout(req.cookies[REFRESH_COOKIE], anonymousContext(req));
  clearRefreshCookie(res);
  return sendSuccess(res, null, { message: 'Logged out' });
}

export async function me(req, res) {
  return sendSuccess(res, req.user);
}

export async function changePassword(req, res) {
  await authService.changePassword(req.user.id, req.validated.body, req.context);
  clearRefreshCookie(res);
  return sendSuccess(res, null, { message: 'Password changed. Please sign in again.' });
}
