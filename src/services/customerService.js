import { db } from '../config/database.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import { STATE_NAME_BY_CODE } from '../constants/masterData.js';
import * as customerRepository from '../repositories/customerRepository.js';
import { ApiError } from '../utils/ApiError.js';
import * as auditService from './auditService.js';

async function getOrThrow(id, trx) {
  const customer = await customerRepository.findById(id, trx);
  if (!customer) throw ApiError.notFound('Customer');
  return customer;
}

/**
 * Keeps GSTIN, state code and state name consistent. The first two digits of a GSTIN
 * are the state code, so a missing state code is derived from it and a mismatch is rejected.
 */
function normalizeStateFields(data, before) {
  const gstin = data.gstin !== undefined ? data.gstin : before?.gstin;
  let stateCode = data.stateCode !== undefined ? data.stateCode : before?.stateCode;

  if (gstin) {
    const gstinState = gstin.slice(0, 2);
    if (!stateCode) stateCode = gstinState;
    if (stateCode !== gstinState) {
      throw ApiError.validation([
        { field: 'stateCode', message: `State code must be ${gstinState} to match the GSTIN` },
      ]);
    }
  }
  if (stateCode && !STATE_NAME_BY_CODE[stateCode]) {
    throw ApiError.validation([{ field: 'stateCode', message: 'Unknown state code' }]);
  }

  const touchesState = !before || data.gstin !== undefined || data.stateCode !== undefined;
  if (!touchesState) return data;
  return {
    ...data,
    stateCode: stateCode ?? null,
    state: stateCode ? STATE_NAME_BY_CODE[stateCode] : null,
  };
}

export const list = (filters) => customerRepository.list(filters);
export const getById = (id) => getOrThrow(id);

export async function create(data, context) {
  return db.transaction(async (trx) => {
    const id = await customerRepository.create(normalizeStateFields(data), context.userId, trx);
    const customer = await getOrThrow(id, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.CREATE,
        module: AUDIT_MODULE.CUSTOMERS,
        recordId: id,
        newValue: customer,
      },
      trx,
    );
    return customer;
  });
}

export async function update(id, data, context) {
  return db.transaction(async (trx) => {
    const before = await getOrThrow(id, trx);
    await customerRepository.update(id, normalizeStateFields(data, before), context.userId, trx);
    const after = await getOrThrow(id, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.UPDATE,
        module: AUDIT_MODULE.CUSTOMERS,
        recordId: id,
        oldValue: before,
        newValue: after,
      },
      trx,
    );
    return after;
  });
}

export async function remove(id, context) {
  return db.transaction(async (trx) => {
    const before = await getOrThrow(id, trx);
    if (await customerRepository.hasHistory(id, trx)) {
      throw ApiError.conflict(
        'This customer has invoices or stock history. Mark it inactive instead.',
        'IN_USE',
      );
    }
    await customerRepository.remove(id, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.DELETE,
        module: AUDIT_MODULE.CUSTOMERS,
        recordId: id,
        oldValue: before,
      },
      trx,
    );
  });
}
