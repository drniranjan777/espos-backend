import { db } from '../config/database.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { TXN_TYPE } from '../constants/transactionTypes.js';
import { canAccessBranch } from '../middleware/branch.js';
import { formatDocumentNo, nextSequenceNumber } from '../repositories/sequenceRepository.js';
import * as transferRepository from '../repositories/transferRepository.js';
import { ApiError } from '../utils/ApiError.js';
import { todayIso } from '../utils/date.js';
import { financialYear } from '../utils/gstCalculator.js';
import * as auditService from './auditService.js';
import { applyMovement } from './inventoryService.js';
import {
  assertStockAvailable,
  lockOrder,
  mergeLines,
  totalQuantity,
} from './stockDocumentHelpers.js';

/**
 * Stock transfer workflow:
 *   REQUESTED  --approve-->  IN_TRANSIT  --receive-->  RECEIVED
 *       |                        |
 *    reject / cancel          cancel (stock returns to the source branch)
 *       v                        v
 *   REJECTED / CANCELLED      CANCELLED
 *
 * Stock leaves the source branch on approval and arrives at the destination on receipt.
 */
export const TRANSFER_STATUS = Object.freeze({
  REQUESTED: 'REQUESTED',
  IN_TRANSIT: 'IN_TRANSIT',
  RECEIVED: 'RECEIVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
});

const PREFIX = 'ST';
const REFERENCE_TYPE = 'TRANSFER';

const can = (user, permission) => user.permissions.includes(permission);

function canSee(user, transfer) {
  return (
    can(user, PERMISSIONS.TRANSFER_APPROVE) ||
    canAccessBranch(user, transfer.fromWarehouseId) ||
    canAccessBranch(user, transfer.toWarehouseId)
  );
}

async function getOrThrow(id, user, trx) {
  const transfer = await transferRepository.findById(id, trx);
  if (!transfer || !canSee(user, transfer)) throw ApiError.notFound('Transfer');
  return transfer;
}

/** Locks the transfer and checks it is in one of the allowed statuses. */
async function lockForAction(id, user, allowed, actionLabel, trx) {
  const locked = await transferRepository.lockById(id, trx);
  if (!locked) throw ApiError.notFound('Transfer');
  const transfer = await getOrThrow(id, user, trx);
  if (!allowed.includes(locked.status)) {
    throw ApiError.conflict(
      `This transfer is ${locked.status.replace('_', ' ').toLowerCase()} and cannot be ${actionLabel}`,
      'INVALID_TRANSFER_STATUS',
    );
  }
  return transfer;
}

/** Books one ledger entry per line in the given branch, in lock order. */
async function moveLines(trx, transfer, warehouseId, type, context, reason) {
  const lines = transfer.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
  for (const line of lockOrder(lines)) {
    await applyMovement(
      trx,
      {
        productId: line.productId,
        warehouseId,
        type,
        quantity: line.quantity,
        referenceType: REFERENCE_TYPE,
        referenceId: transfer.id,
        referenceNo: transfer.transferNo,
        partyName: type === TXN_TYPE.TRANSFER_IN ? transfer.fromBranchName : transfer.toBranchName,
        reason,
        requireActiveProduct: false,
      },
      { ...context, warehouseId },
    );
  }
}

async function audit(context, action, transfer, oldStatus, trx, extra = {}) {
  await auditService.log(
    context,
    {
      action,
      module: AUDIT_MODULE.TRANSFERS,
      recordId: transfer.id,
      oldValue: oldStatus ? { status: oldStatus } : null,
      newValue: { status: transfer.status, transferNo: transfer.transferNo, ...extra },
      warehouseId: transfer.fromWarehouseId,
    },
    trx,
  );
}

export function list(filters, user, warehouseId) {
  const everywhere = filters.scope === 'everywhere' && can(user, PERMISSIONS.TRANSFER_APPROVE);
  return transferRepository.list(everywhere ? null : warehouseId, filters);
}

export const getById = (id, user) => getOrThrow(id, user);

/** Requests a transfer from the current branch. Stock does not move until approval. */
export async function request(data, user, context) {
  const fromId = context.warehouseId;
  if (data.toWarehouseId === fromId) {
    throw ApiError.validation([
      { field: 'toWarehouseId', message: 'Choose a different branch than the current one' },
    ]);
  }
  const lines = mergeLines(data.items);

  return db.transaction(async (trx) => {
    const target = await trx('warehouses').where({ id: data.toWarehouseId }).first('is_active');
    if (!target?.is_active) {
      throw ApiError.validation([{ field: 'toWarehouseId', message: 'Select an active branch' }]);
    }
    // Early feedback: requesting more than the branch holds right now is refused.
    await assertStockAvailable(trx, fromId, lines);

    const fy = financialYear(todayIso());
    const transferNo = formatDocumentNo(PREFIX, fy, await nextSequenceNumber(PREFIX, fy, trx));
    const id = await transferRepository.insertHeader(
      {
        transfer_no: transferNo,
        from_warehouse_id: fromId,
        to_warehouse_id: data.toWarehouseId,
        status: TRANSFER_STATUS.REQUESTED,
        invoice_number: data.invoiceNumber ?? null,
        note: data.note ?? null,
        line_count: lines.length,
        total_quantity: totalQuantity(lines),
        requested_by: context.userId,
      },
      trx,
    );
    await transferRepository.insertItems(
      lines.map((line, index) => ({
        transfer_id: id,
        line_no: index + 1,
        product_id: line.productId,
        quantity: line.quantity,
      })),
      trx,
    );

    const transfer = await getOrThrow(id, user, trx);
    await audit(context, AUDIT_ACTION.CREATE, transfer, null, trx);
    return transfer;
  });
}

/** Approver sends the stock: it leaves the source branch and is in transit. */
export async function approve(id, user, context) {
  return db.transaction(async (trx) => {
    const transfer = await lockForAction(id, user, [TRANSFER_STATUS.REQUESTED], 'approved', trx);
    const lines = transfer.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
    await assertStockAvailable(trx, transfer.fromWarehouseId, lines);
    await moveLines(
      trx,
      transfer,
      transfer.fromWarehouseId,
      TXN_TYPE.TRANSFER_OUT,
      context,
      `Transfer to ${transfer.toBranchName}`,
    );
    await transferRepository.update(
      id,
      {
        status: TRANSFER_STATUS.IN_TRANSIT,
        approved_by: context.userId,
        approved_at: trx.fn.now(),
      },
      trx,
    );
    const after = await getOrThrow(id, user, trx);
    await audit(context, AUDIT_ACTION.APPROVE, after, transfer.status, trx);
    return after;
  });
}

export async function reject(id, { reason }, user, context) {
  return db.transaction(async (trx) => {
    const transfer = await lockForAction(id, user, [TRANSFER_STATUS.REQUESTED], 'rejected', trx);
    await transferRepository.update(
      id,
      {
        status: TRANSFER_STATUS.REJECTED,
        closed_by: context.userId,
        closed_at: trx.fn.now(),
        close_reason: reason,
      },
      trx,
    );
    const after = await getOrThrow(id, user, trx);
    await audit(context, AUDIT_ACTION.REJECT, after, transfer.status, trx, { reason });
    return after;
  });
}

/** The destination branch confirms the goods arrived; stock is added there. */
export async function receive(id, user, context) {
  return db.transaction(async (trx) => {
    const transfer = await lockForAction(id, user, [TRANSFER_STATUS.IN_TRANSIT], 'received', trx);
    if (!canAccessBranch(user, transfer.toWarehouseId)) {
      throw ApiError.forbidden(`Only ${transfer.toBranchName} can receive this transfer`);
    }
    await moveLines(
      trx,
      transfer,
      transfer.toWarehouseId,
      TXN_TYPE.TRANSFER_IN,
      context,
      `Transfer from ${transfer.fromBranchName}`,
    );
    await transferRepository.update(
      id,
      { status: TRANSFER_STATUS.RECEIVED, received_by: context.userId, received_at: trx.fn.now() },
      trx,
    );
    const after = await getOrThrow(id, user, trx);
    await audit(context, AUDIT_ACTION.RECEIVE, after, transfer.status, trx);
    return after;
  });
}

/**
 * Cancels a transfer. The requester may withdraw their own request; approvers may cancel
 * any open transfer. Cancelling an in-transit transfer returns the stock to the source.
 */
export async function cancel(id, { reason }, user, context) {
  return db.transaction(async (trx) => {
    const transfer = await lockForAction(
      id,
      user,
      [TRANSFER_STATUS.REQUESTED, TRANSFER_STATUS.IN_TRANSIT],
      'cancelled',
      trx,
    );
    const isApprover = can(user, PERMISSIONS.TRANSFER_APPROVE);
    const isRequester = transfer.requestedBy === context.userId;
    if (!isApprover && !(isRequester && transfer.status === TRANSFER_STATUS.REQUESTED)) {
      throw ApiError.forbidden('Only an approver can cancel this transfer');
    }
    if (transfer.status === TRANSFER_STATUS.IN_TRANSIT) {
      await moveLines(
        trx,
        transfer,
        transfer.fromWarehouseId,
        TXN_TYPE.TRANSFER_RETURN,
        context,
        `Transfer cancelled: ${reason}`,
      );
    }
    await transferRepository.update(
      id,
      {
        status: TRANSFER_STATUS.CANCELLED,
        closed_by: context.userId,
        closed_at: trx.fn.now(),
        close_reason: reason,
      },
      trx,
    );
    const after = await getOrThrow(id, user, trx);
    await audit(context, AUDIT_ACTION.CANCEL, after, transfer.status, trx, { reason });
    return after;
  });
}
