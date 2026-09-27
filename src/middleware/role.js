import { ApiError } from '../utils/ApiError.js';

/** Allows the request only if the user holds ALL of the given permissions. */
export function requirePermission(...codes) {
  return (req, _res, next) => {
    const granted = req.user?.permissions ?? [];
    if (!codes.every((code) => granted.includes(code))) return next(ApiError.forbidden());
    return next();
  };
}

/** Allows the request if the user holds AT LEAST ONE of the given permissions. */
export function requireAnyPermission(...codes) {
  return (req, _res, next) => {
    const granted = req.user?.permissions ?? [];
    if (!codes.some((code) => granted.includes(code))) return next(ApiError.forbidden());
    return next();
  };
}
