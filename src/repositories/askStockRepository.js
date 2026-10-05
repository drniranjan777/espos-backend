import { db } from '../config/database.js';

/** Read-only queries behind Ask Stock answers. */

// Stock leaving a branch: sales, stock OUT and transfers out.
const OUTBOUND = ['OUT', 'INVOICE_OUT', 'TRANSFER_OUT'];

const PART_COLUMNS = [
  'p.id',
  'p.name',
  'p.sku',
  'p.part_number as partNumber',
  'p.machine_model as machineModel',
  'un.code as unitCode',
  'un.allow_decimal as unitAllowDecimal',
  'p.min_stock_level as minStockLevel',
  'p.selling_price as sellingPrice',
  'p.mrp',
  'p.purchase_price as purchasePrice',
  'i.quantity as stockQuantity',
];

function partsInBranch(warehouseId) {
  return db('products as p')
    .join('units as un', 'un.id', 'p.unit_id')
    .join('inventory as i', (j) =>
      j.on('i.product_id', 'p.id').andOnVal('i.warehouse_id', warehouseId),
    )
    .where('p.is_active', true);
}

/** Stock of one product in each of the given branches (default branch first). */
export function stockAcrossBranches(productId, warehouseIds) {
  return db('warehouses as w')
    .leftJoin('inventory as i', (j) =>
      j.on('i.warehouse_id', 'w.id').andOnVal('i.product_id', productId),
    )
    .whereIn('w.id', warehouseIds)
    .where('w.is_active', true)
    .select(
      'w.id as branchId',
      'w.name as branchName',
      db.raw('COALESCE(i.quantity, 0) as quantity'),
    )
    .orderBy([
      { column: 'w.is_default', order: 'desc' },
      { column: 'w.name', order: 'asc' },
    ]);
}

/**
 * Parts likely to fall to or below their minimum level within `horizonDays`, based on
 * average daily usage over the last `usageDays`.
 */
export function reorderCandidates(warehouseId, { usageDays, horizonDays, limit }) {
  const usage = db('inventory_transactions')
    .where('warehouse_id', warehouseId)
    .whereIn('type', OUTBOUND)
    .where('txn_date', '>=', db.raw('CURRENT_DATE - CAST(? AS int)', [usageDays]))
    .groupBy('product_id')
    .select('product_id', db.raw('-SUM(quantity) as used'));

  return partsInBranch(warehouseId)
    .leftJoin(usage.as('u'), 'u.product_id', 'p.id')
    .select([...PART_COLUMNS, db.raw('COALESCE(u.used, 0) as "usedInPeriod"')])
    .whereRaw('(p.min_stock_level > 0 OR COALESCE(u.used, 0) > 0)')
    .whereRaw('i.quantity - (COALESCE(u.used, 0) * ? / ?) <= p.min_stock_level', [
      horizonDays,
      usageDays,
    ])
    .orderByRaw('i.quantity - p.min_stock_level ASC, p.name ASC')
    .limit(limit);
}

/**
 * Parts in stock that have had no outbound movement for `days` days, limited to parts the
 * branch has held at least that long (stock received yesterday is not "not moving").
 */
export function nonMovingParts(warehouseId, { days, limit }) {
  const cutoff = db.raw('CURRENT_DATE - CAST(? AS int)', [days]);
  return partsInBranch(warehouseId)
    .select([
      ...PART_COLUMNS,
      db.raw(
        `(SELECT MAX(t.txn_date) FROM inventory_transactions t
          WHERE t.product_id = p.id AND t.warehouse_id = i.warehouse_id
            AND t.type = ANY(?)) as "lastOutDate"`,
        [OUTBOUND],
      ),
    ])
    .where('i.quantity', '>', 0)
    .whereNotExists(
      db('inventory_transactions as t')
        .whereRaw('t.product_id = p.id AND t.warehouse_id = i.warehouse_id')
        .whereIn('t.type', OUTBOUND)
        .where('t.txn_date', '>', cutoff),
    )
    .whereExists(
      db('inventory_transactions as t')
        .whereRaw('t.product_id = p.id AND t.warehouse_id = i.warehouse_id')
        .where('t.txn_date', '<=', cutoff),
    )
    .orderByRaw('i.quantity * p.purchase_price DESC, p.name ASC')
    .limit(limit);
}

export function outOfStockParts(warehouseId, limit) {
  return partsInBranch(warehouseId)
    .select(PART_COLUMNS)
    .where('i.quantity', '<=', 0)
    .orderBy('p.name')
    .limit(limit);
}

export function lowStockParts(warehouseId, limit) {
  return partsInBranch(warehouseId)
    .select(PART_COLUMNS)
    .where('i.quantity', '>', 0)
    .whereRaw('i.quantity <= p.min_stock_level')
    .orderByRaw('i.quantity - p.min_stock_level ASC, p.name ASC')
    .limit(limit);
}

/** Parts whose machine model matches, e.g. "pc200" finds "PC200". */
export function partsForMachine(warehouseId, model, limit) {
  const normalized = model.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return partsInBranch(warehouseId)
    .select(PART_COLUMNS)
    .whereRaw(`regexp_replace(upper(COALESCE(p.machine_model, '')), '[^A-Z0-9]', '', 'g') LIKE ?`, [
      `%${normalized}%`,
    ])
    .orderBy('p.name')
    .limit(limit);
}

/** Active customers whose name or company appears in the question. */
export function customersMentioned(text, limit) {
  const lowered = text.toLowerCase();
  return db('customers')
    .where('is_active', true)
    .where((q) =>
      q
        .whereRaw("? LIKE '%' || lower(name) || '%'", [lowered])
        .orWhereRaw("company_name IS NOT NULL AND ? LIKE '%' || lower(company_name) || '%'", [
          lowered,
        ])
        .orWhereRaw('word_similarity(lower(name), ?) >= 0.8', [lowered])
        .orWhereRaw("word_similarity(lower(COALESCE(company_name, '')), ?) >= 0.8", [lowered]),
    )
    .select('id', 'name', 'company_name as companyName', 'mobile', 'city')
    .orderByRaw('length(COALESCE(company_name, name)) DESC')
    .limit(limit);
}

/** Invoices and parts that went to a customer from this branch since `fromDate`. */
export async function customerActivity(customerId, warehouseId, fromDate) {
  const [invoices, items] = await Promise.all([
    db('invoices')
      .where({ customer_id: customerId, warehouse_id: warehouseId, status: 'FINAL' })
      .where('invoice_date', '>=', fromDate)
      .first(db.raw('count(*)::int as count'), db.raw('COALESCE(SUM(grand_total), 0) as total')),
    db('inventory_transactions as t')
      .join('products as p', 'p.id', 't.product_id')
      .join('units as un', 'un.id', 'p.unit_id')
      .where({ 't.customer_id': customerId, 't.warehouse_id': warehouseId })
      .whereIn('t.type', ['OUT', 'INVOICE_OUT'])
      .where('t.txn_date', '>=', fromDate)
      .groupBy('p.id', 'p.name', 'p.sku', 'un.code')
      .select(
        'p.id',
        'p.name',
        'p.sku',
        'un.code as unitCode',
        db.raw('-SUM(t.quantity) as quantity'),
        db.raw('MAX(t.txn_date) as "lastDate"'),
      )
      .orderBy('quantity', 'desc')
      .limit(10),
  ]);
  return { invoiceCount: invoices.count, invoiceTotal: invoices.total, items };
}
