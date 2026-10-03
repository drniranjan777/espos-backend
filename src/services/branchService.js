import { db } from '../config/database.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import { STATE_NAME_BY_CODE } from '../constants/masterData.js';
import * as warehouseRepository from '../repositories/warehouseRepository.js';
import { ApiError } from '../utils/ApiError.js';
import * as auditService from './auditService.js';

async function getOrThrow(id, trx) {
  const branch = await warehouseRepository.findById(id, trx);
  if (!branch) throw ApiError.notFound('Branch');
  return branch;
}

function withStateName(data) {
  if (data.stateCode === undefined) return data;
  if (data.stateCode && !STATE_NAME_BY_CODE[data.stateCode]) {
    throw ApiError.validation([{ field: 'stateCode', message: 'Unknown state code' }]);
  }
  return { ...data, state: data.stateCode ? STATE_NAME_BY_CODE[data.stateCode] : null };
}

export const list = (filters) => warehouseRepository.list(filters);
export const getById = (id) => getOrThrow(id);

export async function create(data, context) {
  return db.transaction(async (trx) => {
    const id = await warehouseRepository.create(withStateName(data), context.userId, trx);
    const branch = await getOrThrow(id, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.CREATE,
        module: AUDIT_MODULE.BRANCHES,
        recordId: id,
        newValue: branch,
      },
      trx,
    );
    return branch;
  });
}

/**
 * Updates a branch. A branch can only be deactivated when it holds no stock and has no
 * open transfers, and the default branch always stays active.
 */
export async function update(id, data, context) {
  return db.transaction(async (trx) => {
    const before = await getOrThrow(id, trx);
    if (data.isActive === false && before.isActive) {
      if (before.isDefault) throw ApiError.badRequest('The default branch cannot be deactivated');
      if (await warehouseRepository.hasStock(id, trx)) {
        throw ApiError.conflict('Move or adjust all stock out of this branch first', 'IN_USE');
      }
      if (await warehouseRepository.hasOpenTransfers(id, trx)) {
        throw ApiError.conflict('Finish or cancel this branch’s open transfers first', 'IN_USE');
      }
    }
    await warehouseRepository.update(id, withStateName(data), context.userId, trx);
    const after = await getOrThrow(id, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.UPDATE,
        module: AUDIT_MODULE.BRANCHES,
        recordId: id,
        oldValue: before,
        newValue: after,
      },
      trx,
    );
    return after;
  });
}
