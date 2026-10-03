import { db } from '../config/database.js';

// What counts as stock "IN" and "OUT" for a branch. Transfers are real movements for the
// branch; adjustments are corrections and invoice cancellations reverse invoice OUTs.
const IN_TYPES = ['OPENING', 'IN', 'TRANSFER_IN', 'TRANSFER_RETURN'];
const OUT_TYPES = ['OUT', 'INVOICE_OUT', 'TRANSFER_OUT'];

export async function stockSummary(warehouseId) {
  return db('products as p')
    .join('inventory as i', (j) =>
      j.on('i.product_id', 'p.id').andOnVal('i.warehouse_id', warehouseId),
    )
    .where('p.is_active', true)
    .first(
      db.raw('count(*)::int as "totalProducts"'),
      db.raw('COALESCE(sum(i.quantity), 0) as "totalStockQuantity"'),
      db.raw('COALESCE(sum(i.quantity * p.purchase_price), 0)::numeric(16,2) as "stockValue"'),
      db.raw(
        'count(*) FILTER (WHERE i.quantity > 0 AND i.quantity <= p.min_stock_level)::int as "lowStockCount"',
      ),
      db.raw('count(*) FILTER (WHERE i.quantity <= 0)::int as "outOfStockCount"'),
    );
}

export async function movementOn(warehouseId, date) {
  return db('inventory_transactions')
    .where({ warehouse_id: warehouseId, txn_date: date })
    .first(
      db.raw('COALESCE(sum(quantity) FILTER (WHERE type = ANY(?)), 0) as "stockIn"', [IN_TYPES]),
      db.raw('COALESCE(-sum(quantity) FILTER (WHERE type = ANY(?)), 0) as "stockOut"', [OUT_TYPES]),
      db.raw('count(*) FILTER (WHERE type = ANY(?))::int as "inCount"', [IN_TYPES]),
      db.raw('count(*) FILTER (WHERE type = ANY(?))::int as "outCount"', [OUT_TYPES]),
    );
}

export async function salesOn(warehouseId, date) {
  return db('invoices')
    .where({ warehouse_id: warehouseId, invoice_date: date, status: 'FINAL' })
    .first(
      db.raw('count(*)::int as "invoiceCount"'),
      db.raw('COALESCE(sum(grand_total), 0) as "salesValue"'),
    );
}

const BUCKETS = {
  daily: { unit: 'day', count: 14, step: '1 day' },
  weekly: { unit: 'week', count: 12, step: '1 week' },
  monthly: { unit: 'month', count: 12, step: '1 month' },
};

/** IN vs OUT totals per day/week/month, including empty periods, ending at `today`. */
export async function movementSeries(warehouseId, range, today) {
  const { unit, count, step } = BUCKETS[range];
  const { rows } = await db.raw(
    `
    WITH periods AS (
      SELECT generate_series(
        date_trunc(:unit, CAST(:today AS date)) - (:count - 1) * CAST(:step AS interval),
        date_trunc(:unit, CAST(:today AS date)),
        CAST(:step AS interval)
      )::date AS period
    )
    SELECT
      to_char(p.period, 'YYYY-MM-DD') AS period,
      COALESCE(sum(t.quantity) FILTER (WHERE t.type = ANY(:inTypes)), 0) AS "stockIn",
      COALESCE(-sum(t.quantity) FILTER (WHERE t.type = ANY(:outTypes)), 0) AS "stockOut"
    FROM periods p
    LEFT JOIN inventory_transactions t
      ON t.warehouse_id = :warehouseId
     AND date_trunc(:unit, t.txn_date)::date = p.period
    GROUP BY p.period
    ORDER BY p.period
    `,
    { unit, today, count, step, inTypes: IN_TYPES, outTypes: OUT_TYPES, warehouseId },
  );
  return rows;
}

export async function transferCounts(warehouseId) {
  return db('stock_transfers').first(
    db.raw(
      `count(*) FILTER (WHERE status = 'REQUESTED' AND from_warehouse_id = ?)::int as "awaitingApproval"`,
      [warehouseId],
    ),
    db.raw(
      `count(*) FILTER (WHERE status = 'IN_TRANSIT' AND to_warehouse_id = ?)::int as "incoming"`,
      [warehouseId],
    ),
  );
}

export async function topMovingProducts(warehouseId, fromDate, limit) {
  return db('inventory_transactions as t')
    .join('products as p', 'p.id', 't.product_id')
    .join('units as un', 'un.id', 'p.unit_id')
    .where('t.warehouse_id', warehouseId)
    .whereIn('t.type', OUT_TYPES)
    .where('t.txn_date', '>=', fromDate)
    .groupBy('p.id', 'p.name', 'p.sku', 'un.code')
    .select(
      'p.id',
      'p.name',
      'p.sku',
      'un.code as unitCode',
      db.raw('-sum(t.quantity) as "quantityOut"'),
      db.raw('count(*)::int as "movements"'),
    )
    .orderBy('quantityOut', 'desc')
    .limit(limit);
}

export async function lowStockProducts(warehouseId, limit) {
  return db('products as p')
    .join('inventory as i', (j) =>
      j.on('i.product_id', 'p.id').andOnVal('i.warehouse_id', warehouseId),
    )
    .join('units as un', 'un.id', 'p.unit_id')
    .where('p.is_active', true)
    .whereRaw('i.quantity <= p.min_stock_level')
    .select(
      'p.id',
      'p.name',
      'p.sku',
      'p.part_number as partNumber',
      'un.code as unitCode',
      'i.quantity as stockQuantity',
      'p.min_stock_level as minStockLevel',
    )
    .orderByRaw('i.quantity - p.min_stock_level, p.name')
    .limit(limit);
}

/** Per-product stock with purchase and selling valuation (stock valuation report). */
export async function stockValuation(warehouseId, { search, categoryId }) {
  const query = db('products as p')
    .join('inventory as i', (j) =>
      j.on('i.product_id', 'p.id').andOnVal('i.warehouse_id', warehouseId),
    )
    .join('units as un', 'un.id', 'p.unit_id')
    .leftJoin('categories as c', 'c.id', 'p.category_id')
    .where('p.is_active', true)
    .select(
      'p.id',
      'p.name',
      'p.sku',
      'c.name as categoryName',
      'un.code as unitCode',
      'i.quantity as stockQuantity',
      'p.purchase_price as purchasePrice',
      'p.selling_price as sellingPrice',
      db.raw('(i.quantity * p.purchase_price)::numeric(16,2) as "purchaseValue"'),
      db.raw('(i.quantity * p.selling_price)::numeric(16,2) as "sellingValue"'),
    )
    .orderBy('p.name');
  if (search) {
    query.where((q) => q.whereILike('p.name', `%${search}%`).orWhereILike('p.sku', `%${search}%`));
  }
  if (categoryId) query.where('p.category_id', categoryId);
  return query;
}

/** Opening, IN, OUT, adjustments and closing per product for a date range (movement report). */
export async function movementReport(warehouseId, { from, to, search }) {
  const { rows } = await db.raw(
    `
    SELECT
      p.id, p.name, p.sku, un.code AS "unitCode",
      COALESCE((
        SELECT sum(t0.quantity) FROM inventory_transactions t0
        WHERE t0.product_id = p.id AND t0.warehouse_id = :warehouseId AND t0.txn_date < :from
      ), 0) AS "openingBalance",
      COALESCE(sum(t.quantity) FILTER (WHERE t.type = ANY(:inTypes)), 0) AS "stockIn",
      COALESCE(-sum(t.quantity) FILTER (WHERE t.type = ANY(:outTypes)), 0) AS "stockOut",
      COALESCE(sum(t.quantity) FILTER (WHERE t.type IN ('ADJUSTMENT_IN','ADJUSTMENT_OUT','INVOICE_CANCEL')), 0) AS "adjustments",
      COALESCE(sum(t.quantity), 0) AS "netChange"
    FROM products p
    JOIN units un ON un.id = p.unit_id
    LEFT JOIN inventory_transactions t
      ON t.product_id = p.id AND t.warehouse_id = :warehouseId AND t.txn_date BETWEEN :from AND :to
    WHERE (CAST(:search AS text) IS NULL OR p.name ILIKE '%' || :search || '%' OR p.sku ILIKE '%' || :search || '%')
    GROUP BY p.id, p.name, p.sku, un.code
    HAVING count(t.id) > 0
    ORDER BY p.name
    `,
    { warehouseId, from, to, search: search ?? null, inTypes: IN_TYPES, outTypes: OUT_TYPES },
  );
  return rows.map((r) => ({
    ...r,
    closingBalance: Number(r.openingBalance) + Number(r.netChange),
  }));
}
