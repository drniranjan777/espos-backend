import { db } from '../config/database.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import { TXN_TYPE } from '../constants/transactionTypes.js';
import * as movementRepository from '../repositories/movementRepository.js';
import { formatDocumentNo, nextSequenceNumber } from '../repositories/sequenceRepository.js';
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

export const MOVEMENT_PREFIX = { IN: 'SI', OUT: 'SO' };
const REFERENCE_TYPE = 'MOVEMENT';

async function loadCustomer(trx, customerId) {
  const customer = await trx('customers')
    .where({ id: customerId })
    .first('id', 'name', 'company_name', 'is_active');
  if (!customer) throw ApiError.badRequest('Selected customer does not exist');
  if (!customer.is_active) throw ApiError.badRequest('Selected customer is inactive');
  return customer;
}

async function getOrThrow(id, warehouseId, trx) {
  const movement = await movementRepository.findById(id, trx);
  if (!movement || movement.warehouseId !== warehouseId) throw ApiError.notFound('Stock entry');
  return movement;
}

export const list = (filters, warehouseId) => movementRepository.list(warehouseId, filters);
export const getById = (id, warehouseId) => getOrThrow(id, warehouseId);

/**
 * Records a multi-item Stock IN or Stock OUT in the current branch as one numbered
 * document (e.g. SO/2026-27/0001). All lines succeed or none do.
 */
export async function create(data, context) {
  const { warehouseId } = context;
  const lines = mergeLines(data.items);
  const date = data.date ?? todayIso();

  return db.transaction(async (trx) => {
    let { partyName = null, customerId = null } = data;
    let invoiceNumber = data.invoiceNumber ?? null;
    if (data.noBill) {
      invoiceNumber = null;
      partyName = null;
      customerId = null;
    }
    if (customerId) {
      const customer = await loadCustomer(trx, customerId);
      partyName ??= customer.company_name || customer.name;
    }

    if (data.type === 'OUT') await assertStockAvailable(trx, warehouseId, lines);

    const prefix = MOVEMENT_PREFIX[data.type];
    const fy = financialYear(date);
    const movementNo = formatDocumentNo(prefix, fy, await nextSequenceNumber(prefix, fy, trx));

    const id = await movementRepository.insertHeader(
      {
        movement_no: movementNo,
        type: data.type,
        warehouse_id: warehouseId,
        no_bill: data.noBill,
        invoice_number: invoiceNumber,
        customer_id: customerId,
        party_name: partyName,
        note: data.note ?? null,
        movement_date: date,
        line_count: lines.length,
        total_quantity: totalQuantity(lines),
        created_by: context.userId,
      },
      trx,
    );

    const transactionIds = new Map();
    for (const line of lockOrder(lines)) {
      const result = await applyMovement(
        trx,
        {
          productId: line.productId,
          warehouseId,
          type: data.type === 'IN' ? TXN_TYPE.IN : TXN_TYPE.OUT,
          quantity: line.quantity,
          customerId,
          partyName,
          referenceType: REFERENCE_TYPE,
          referenceId: id,
          referenceNo: invoiceNumber ? `${movementNo} · ${invoiceNumber}` : movementNo,
          notes: data.note,
          txnDate: date,
        },
        context,
      );
      transactionIds.set(line.productId, result.transactionId);
    }

    await movementRepository.insertItems(
      lines.map((line, index) => ({
        movement_id: id,
        line_no: index + 1,
        product_id: line.productId,
        quantity: line.quantity,
        transaction_id: transactionIds.get(line.productId),
      })),
      trx,
    );

    const movement = await getOrThrow(id, warehouseId, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.CREATE,
        module: AUDIT_MODULE.STOCK_MOVEMENTS,
        recordId: id,
        newValue: movement,
        warehouseId,
      },
      trx,
    );
    return movement;
  });
}
