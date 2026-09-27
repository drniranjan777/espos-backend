import { db } from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Phase 1 works against a single default warehouse. Phase 2 replaces callers of this
 * with the warehouse chosen by (and permitted for) the current user.
 */
export async function getDefaultWarehouseId(trx = db) {
  const row = await trx('warehouses').where({ is_default: true, is_active: true }).first('id');
  if (!row) throw new ApiError(500, 'NO_DEFAULT_WAREHOUSE', 'Default warehouse is not configured');
  return row.id;
}
