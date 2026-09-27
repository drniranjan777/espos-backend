import Decimal from 'decimal.js';
import { db } from '../config/database.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import { INBOUND_TYPES, TXN_TYPE } from '../constants/transactionTypes.js';
import { adjustmentCodeRepository } from '../repositories/masters.js';
import * as inventoryRepository from '../repositories/inventoryRepository.js';
import { getDefaultWarehouseId } from '../repositories/warehouseRepository.js';
import { ApiError } from '../utils/ApiError.js';
import * as auditService from './auditService.js';

const AUDIT_ACTION_BY_TYPE = {
  [TXN_TYPE.OPENING]: AUDIT_ACTION.STOCK_IN,
  [TXN_TYPE.IN]: AUDIT_ACTION.STOCK_IN,
  [TXN_TYPE.OUT]: AUDIT_ACTION.STOCK_OUT,
  [TXN_TYPE.ADJUSTMENT_IN]: AUDIT_ACTION.STOCK_ADJUST,
  [TXN_TYPE.ADJUSTMENT_OUT]: AUDIT_ACTION.STOCK_ADJUST,
  [TXN_TYPE.INVOICE_OUT]: AUDIT_ACTION.STOCK_OUT,
  [TXN_TYPE.INVOICE_CANCEL]: AUDIT_ACTION.STOCK_IN,
};

async function loadProductForMovement(trx, productId) {
  const product = await trx('products as p')
    .join('units as un', 'un.id', 'p.unit_id')
    .where('p.id', productId)
    .first('p.id', 'p.name', 'p.is_active', 'un.code as unit_code', 'un.allow_decimal');
  if (!product) throw ApiError.notFound('Product');
  return product;
}

function formatQty(value, unitCode) {
  return `${new Decimal(value).toString()} ${unitCode}`;
}

/**
 * THE ONLY code path that changes stock. Must be called inside a transaction.
 *
 * Locks the stock row, validates the movement, writes an immutable ledger entry with
 * previous/new balances, updates the stock row and records an audit entry. Everything
 * commits or rolls back together with the caller's transaction.
 *
 * @param {import('knex').Knex.Transaction} trx
 * @param {object} movement
 * @param {number} movement.productId
 * @param {number} movement.warehouseId
 * @param {string} movement.type          one of TXN_TYPE
 * @param {number} movement.quantity      positive amount; direction comes from the type
 * @param {boolean} [movement.requireActiveProduct=true]
 * @param {object} context                { userId, ip, userAgent }
 * @returns {Promise<{ transactionId: number, previousBalance: number, newBalance: number }>}
 */
export async function applyMovement(trx, movement, context) {
  const { productId, warehouseId, type, requireActiveProduct = true } = movement;
  const quantity = new Decimal(movement.quantity);
  if (!quantity.isFinite() || quantity.lte(0)) throw ApiError.badRequest('Quantity must be greater than 0');

  const product = await loadProductForMovement(trx, productId);
  if (requireActiveProduct && !product.is_active) {
    throw ApiError.badRequest(`${product.name} is inactive`);
  }
  if (!product.allow_decimal && !quantity.isInteger()) {
    throw ApiError.badRequest(`${product.unit_code} quantities must be whole numbers`);
  }

  const stock = await inventoryRepository.lockStockRow(trx, warehouseId, productId);
  const previous = new Decimal(stock.quantity);
  const change = INBOUND_TYPES.includes(type) ? quantity : quantity.negated();
  const next = previous.plus(change);

  if (next.isNegative()) {
    throw ApiError.conflict(
      `Insufficient stock for ${product.name}. Available: ${formatQty(previous, product.unit_code)}, requested: ${formatQty(quantity, product.unit_code)}`,
      'INSUFFICIENT_STOCK',
      { productId, available: previous.toNumber(), requested: quantity.toNumber() },
    );
  }

  const transactionId = await inventoryRepository.insertTransaction(trx, {
    warehouse_id: warehouseId,
    product_id: productId,
    type,
    quantity: change.toString(),
    previous_balance: previous.toString(),
    new_balance: next.toString(),
    unit_price: movement.unitPrice ?? null,
    customer_id: movement.customerId ?? null,
    reference_type: movement.referenceType ?? null,
    reference_id: movement.referenceId ?? null,
    reference_no: movement.referenceNo ?? null,
    party_name: movement.partyName ?? null,
    reason: movement.reason ?? null,
    notes: movement.notes ?? null,
    txn_date: movement.txnDate ?? trx.raw('CURRENT_DATE'),
    created_by: context.userId,
  });
  await inventoryRepository.setQuantity(trx, stock.id, next.toString());

  await auditService.log(
    context,
    {
      action: AUDIT_ACTION_BY_TYPE[type],
      module: AUDIT_MODULE.INVENTORY,
      recordId: transactionId,
      oldValue: { productId, quantity: previous.toNumber() },
      newValue: { productId, type, change: change.toNumber(), quantity: next.toNumber() },
      warehouseId,
    },
    trx,
  );

  return { transactionId, previousBalance: previous.toNumber(), newBalance: next.toNumber() };
}

async function assertCustomerExists(trx, customerId) {
  if (!customerId) return;
  const customer = await trx('customers').where({ id: customerId }).first('id', 'is_active');
  if (!customer) throw ApiError.badRequest('Selected customer does not exist');
  if (!customer.is_active) throw ApiError.badRequest('Selected customer is inactive');
}

export async function stockIn(data, context) {
  return db.transaction(async (trx) => {
    const warehouseId = await getDefaultWarehouseId(trx);
    const result = await applyMovement(
      trx,
      {
        productId: data.productId,
        warehouseId,
        type: TXN_TYPE.IN,
        quantity: data.quantity,
        unitPrice: data.purchasePrice,
        partyName: data.supplier,
        referenceNo: data.reference,
        notes: data.notes,
        txnDate: data.date,
      },
      context,
    );
    return inventoryRepository.findTransactionById(result.transactionId, trx);
  });
}

export async function stockOut(data, context) {
  return db.transaction(async (trx) => {
    await assertCustomerExists(trx, data.customerId);
    const warehouseId = await getDefaultWarehouseId(trx);
    const result = await applyMovement(
      trx,
      {
        productId: data.productId,
        warehouseId,
        type: TXN_TYPE.OUT,
        quantity: data.quantity,
        customerId: data.customerId,
        reason: data.reason,
        referenceNo: data.reference,
        notes: data.notes,
        txnDate: data.date,
      },
      context,
    );
    return inventoryRepository.findTransactionById(result.transactionId, trx);
  });
}

/**
 * Stock adjustment with a mandatory reason code.
 * - mode IN / OUT: add or remove `quantity`.
 * - mode SET: physical count; the difference to current stock is booked automatically.
 */
export async function adjust(data, context) {
  return db.transaction(async (trx) => {
    const code = await adjustmentCodeRepository.findById(data.adjustmentCodeId, trx);
    if (!code || !code.isActive) throw ApiError.badRequest('Select a valid adjustment reason');

    const warehouseId = await getDefaultWarehouseId(trx);
    let direction = data.mode;
    let quantity = new Decimal(data.quantity);

    if (data.mode === 'SET') {
      const stock = await inventoryRepository.lockStockRow(trx, warehouseId, data.productId);
      const difference = quantity.minus(stock.quantity);
      if (difference.isZero()) {
        throw ApiError.badRequest('Physical count matches the current stock; nothing to adjust');
      }
      direction = difference.isPositive() ? 'IN' : 'OUT';
      quantity = difference.abs();
    }

    if (code.direction !== 'BOTH' && code.direction !== direction) {
      throw ApiError.badRequest(`"${code.name}" can only be used to ${code.direction === 'IN' ? 'add' : 'remove'} stock`);
    }

    const result = await applyMovement(
      trx,
      {
        productId: data.productId,
        warehouseId,
        type: direction === 'IN' ? TXN_TYPE.ADJUSTMENT_IN : TXN_TYPE.ADJUSTMENT_OUT,
        quantity: quantity.toString(),
        reason: `${code.name}: ${data.reason}`,
        notes: data.notes,
        txnDate: data.date,
        requireActiveProduct: false,
      },
      context,
    );

    await inventoryRepository.insertAdjustment(trx, {
      transaction_id: result.transactionId,
      adjustment_code_id: code.id,
      reason: data.reason,
      physical_count: data.mode === 'SET' ? data.quantity : null,
      created_by: context.userId,
    });

    return inventoryRepository.findTransactionById(result.transactionId, trx);
  });
}

export async function listLedger(filters) {
  const warehouseId = await getDefaultWarehouseId();
  return inventoryRepository.listLedger(warehouseId, filters);
}
