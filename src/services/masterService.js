import { db } from '../config/database.js';
import { AUDIT_ACTION } from '../constants/audit.js';
import { ApiError } from '../utils/ApiError.js';
import * as auditService from './auditService.js';

/**
 * Builds CRUD services for a master table with audit logging.
 *
 * @param {ReturnType<import('../repositories/masterRepository.js').createMasterRepository>} repository
 * @param {object} options
 * @param {string} options.module       audit module name
 * @param {string} options.entityName   human name used in errors ("Brand")
 * @param {(data: object, before: object|null, trx: any) => Promise<void>} [options.beforeSave] extra validation
 */
export function createMasterService(repository, { module, entityName, beforeSave }) {
  async function getById(id, trx) {
    const record = await repository.findById(id, trx);
    if (!record) throw ApiError.notFound(entityName);
    return record;
  }

  return {
    list: (filters) => repository.list(filters),

    getById: (id) => getById(id),

    create(data, context) {
      return db.transaction(async (trx) => {
        await beforeSave?.(data, null, trx);
        const id = await repository.create(data, context.userId, trx);
        const created = await getById(id, trx);
        await auditService.log(
          context,
          { action: AUDIT_ACTION.CREATE, module, recordId: id, newValue: created },
          trx,
        );
        return created;
      });
    },

    update(id, data, context) {
      return db.transaction(async (trx) => {
        const before = await getById(id, trx);
        await beforeSave?.(data, before, trx);
        await repository.update(id, data, context.userId, trx);
        const after = await getById(id, trx);
        await auditService.log(
          context,
          { action: AUDIT_ACTION.UPDATE, module, recordId: id, oldValue: before, newValue: after },
          trx,
        );
        return after;
      });
    },

    /** Hard delete; fails with IN_USE (via the FK constraint) when the record is referenced. */
    remove(id, context) {
      return db.transaction(async (trx) => {
        const before = await getById(id, trx);
        await repository.remove(id, trx);
        await auditService.log(
          context,
          { action: AUDIT_ACTION.DELETE, module, recordId: id, oldValue: before },
          trx,
        );
      });
    },
  };
}
