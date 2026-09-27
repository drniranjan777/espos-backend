import * as auditRepository from '../repositories/auditRepository.js';

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordHash',
  'token',
  'token_hash',
]);

/**
 * Serialises a value for a JSONB column with secrets removed. Passed as a string because
 * node-postgres would otherwise encode top-level arrays as Postgres arrays.
 */
function toJson(value) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value, (key, v) => (SENSITIVE_KEYS.has(key) ? undefined : v));
}

/**
 * Records an audit entry. Pass the active transaction so the audit row commits
 * or rolls back together with the change it describes.
 *
 * @param {object} context  request context: { userId, ip, userAgent }
 */
export async function log(
  context,
  { action, module, recordId, oldValue, newValue, warehouseId },
  trx,
) {
  await auditRepository.insert(
    {
      user_id: context?.userId ?? null,
      ip: context?.ip ?? null,
      user_agent: context?.userAgent ?? null,
      action,
      module,
      record_id: recordId === undefined || recordId === null ? null : String(recordId),
      old_value: toJson(oldValue),
      new_value: toJson(newValue),
      warehouse_id: warehouseId ?? null,
    },
    trx,
  );
}

export function list(filters) {
  return auditRepository.list(filters);
}
