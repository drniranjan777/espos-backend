import { PERMISSIONS as P } from '../constants/permissions.js';

/**
 * Purchase prices (what the business pays for parts) are for Admin only. `purchase.price` is an
 * admin-only permission (see ADMIN_ONLY_PERMISSIONS), so holding it means being an Admin; every
 * API response that carries a cost asks this one question.
 */
export const canViewPurchasePrice = (user) => Boolean(user?.permissions?.includes(P.PURCHASE_PRICE));

/** Copy of `object` without the given keys. */
export function omit(object, ...keys) {
  const copy = { ...object };
  for (const key of keys) delete copy[key];
  return copy;
}
