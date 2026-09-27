import { db } from '../config/database.js';
import { paginate } from '../utils/pagination.js';

/**
 * Locks the stock row for (warehouse, product) for the rest of the transaction, creating it
 * if missing. Concurrent movements on the same product therefore run one after another.
 */
export async function lockStockRow(trx, warehouseId, productId) {
  await trx('inventory')
    .insert({ warehouse_id: warehouseId, product_id: productId, quantity: 0 })
    .onConflict(['warehouse_id', 'product_id'])
    .ignore();
  return trx('inventory')
    .where({ warehouse_id: warehouseId, product_id: productId })
    .forUpdate()
    .first('id', 'quantity');
}

export async function setQuantity(trx, inventoryId, quantity) {
  await trx('inventory').where({ id: inventoryId }).update({ quantity });
}

export async function insertTransaction(trx, data) {
  const [row] = await trx('inventory_transactions').insert(data).returning('id');
  return row.id;
}

export async function insertAdjustment(trx, data) {
  await trx('stock_adjustments').insert(data);
}

const LEDGER_COLUMNS = [
  't.id',
  't.type',
  't.quantity',
  't.previous_balance as previousBalance',
  't.new_balance as newBalance',
  't.unit_price as unitPrice',
  't.reference_type as referenceType',
  't.reference_id as referenceId',
  't.reference_no as referenceNo',
  't.party_name as partyName',
  't.reason',
  't.notes',
  't.txn_date as txnDate',
  't.created_at as createdAt',
  't.product_id as productId',
  'p.name as productName',
  'p.sku',
  'p.part_number as partNumber',
  'un.code as unitCode',
  't.customer_id as customerId',
  'cu.name as customerName',
  't.created_by as userId',
  'u.name as userName',
  'ac.name as adjustmentCodeName',
];

function ledgerQuery(trx = db) {
  return trx('inventory_transactions as t')
    .join('products as p', 'p.id', 't.product_id')
    .join('units as un', 'un.id', 'p.unit_id')
    .leftJoin('customers as cu', 'cu.id', 't.customer_id')
    .leftJoin('users as u', 'u.id', 't.created_by')
    .leftJoin('stock_adjustments as sa', 'sa.transaction_id', 't.id')
    .leftJoin('adjustment_codes as ac', 'ac.id', 'sa.adjustment_code_id');
}

export async function findTransactionById(id, trx = db) {
  return (await ledgerQuery(trx).where('t.id', id).first(LEDGER_COLUMNS)) ?? null;
}

// Ledger rows for a product are inserted while its stock row is locked, so the id order is
// the true posting order ("createdAt" sorts by id for that reason).
export const LEDGER_SORT_FIELDS = { createdAt: 't.id', txnDate: 't.txn_date' };

export function listLedger(warehouseId, filters) {
  const query = ledgerQuery().select(LEDGER_COLUMNS).where('t.warehouse_id', warehouseId);
  if (filters.productId) query.where('t.product_id', filters.productId);
  if (filters.types?.length) query.whereIn('t.type', filters.types);
  if (filters.userId) query.where('t.created_by', filters.userId);
  if (filters.customerId) query.where('t.customer_id', filters.customerId);
  if (filters.from) query.where('t.txn_date', '>=', filters.from);
  if (filters.to) query.where('t.txn_date', '<=', filters.to);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query.where((q) =>
      q
        .whereILike('p.name', term)
        .orWhereILike('p.sku', term)
        .orWhereILike('p.part_number', term)
        .orWhereILike('t.reference_no', term),
    );
  }
  return paginate(query, filters, LEDGER_SORT_FIELDS, 't.id');
}
