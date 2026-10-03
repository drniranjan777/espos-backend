import { db } from '../config/database.js';
import { paginate } from '../utils/pagination.js';

const HEADER_COLUMNS = [
  'm.id',
  'm.movement_no as movementNo',
  'm.type',
  'm.warehouse_id as warehouseId',
  'w.name as branchName',
  'm.no_bill as noBill',
  'm.invoice_number as invoiceNumber',
  'm.customer_id as customerId',
  'm.party_name as partyName',
  'm.note',
  'm.movement_date as movementDate',
  'm.line_count as lineCount',
  'm.total_quantity as totalQuantity',
  'm.created_at as createdAt',
  'u.name as createdByName',
];

function baseQuery(trx = db) {
  return trx('stock_movements as m')
    .join('warehouses as w', 'w.id', 'm.warehouse_id')
    .leftJoin('users as u', 'u.id', 'm.created_by');
}

export async function insertHeader(data, trx) {
  const [row] = await trx('stock_movements').insert(data).returning('id');
  return row.id;
}

export async function insertItems(rows, trx) {
  await trx('stock_movement_items').insert(rows);
}

export async function findById(id, trx = db) {
  const movement = await baseQuery(trx).where('m.id', id).first(HEADER_COLUMNS);
  if (!movement) return null;
  movement.items = await trx('stock_movement_items as mi')
    .join('products as p', 'p.id', 'mi.product_id')
    .join('units as un', 'un.id', 'p.unit_id')
    .leftJoin('inventory_transactions as t', 't.id', 'mi.transaction_id')
    .where('mi.movement_id', id)
    .orderBy('mi.line_no')
    .select(
      'mi.line_no as lineNo',
      'mi.product_id as productId',
      'p.name as productName',
      'p.sku',
      'p.part_number as partNumber',
      'un.code as unitCode',
      'mi.quantity',
      't.previous_balance as previousBalance',
      't.new_balance as newBalance',
    );
  return movement;
}

export const MOVEMENT_SORT_FIELDS = { createdAt: 'm.id', movementDate: 'm.movement_date' };

export function list(warehouseId, filters) {
  const query = baseQuery().select(HEADER_COLUMNS).where('m.warehouse_id', warehouseId);
  if (filters.type) query.where('m.type', filters.type);
  if (filters.from) query.where('m.movement_date', '>=', filters.from);
  if (filters.to) query.where('m.movement_date', '<=', filters.to);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query.where((q) =>
      q
        .whereILike('m.movement_no', term)
        .orWhereILike('m.invoice_number', term)
        .orWhereILike('m.party_name', term),
    );
  }
  return paginate(query, filters, MOVEMENT_SORT_FIELDS, 'm.id');
}
