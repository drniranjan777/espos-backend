import { db } from '../config/database.js';
import { paginate } from '../utils/pagination.js';

/** API field -> column for writes. */
const WRITABLE = {
  name: 'name',
  sku: 'sku',
  partNumber: 'part_number',
  categoryId: 'category_id',
  brandId: 'brand_id',
  machineModel: 'machine_model',
  unitId: 'unit_id',
  hsnCode: 'hsn_code',
  purchasePrice: 'purchase_price',
  sellingPrice: 'selling_price',
  mrp: 'mrp',
  gstRateId: 'gst_rate_id',
  minStockLevel: 'min_stock_level',
  description: 'description',
  isActive: 'is_active',
};

const SUMMARY_COLUMNS = [
  'p.id',
  'p.name',
  'p.sku',
  'p.part_number as partNumber',
  'p.machine_model as machineModel',
  'p.hsn_code as hsnCode',
  'p.selling_price as sellingPrice',
  'p.mrp',
  'p.min_stock_level as minStockLevel',
  'p.is_active as isActive',
  'b.name as brandName',
  'c.name as categoryName',
  'un.code as unitCode',
  'un.allow_decimal as unitAllowDecimal',
  'g.rate as gstRate',
  db.raw('COALESCE(i.quantity, 0) as "stockQuantity"'),
];

const DETAIL_COLUMNS = [
  ...SUMMARY_COLUMNS,
  'p.category_id as categoryId',
  'p.brand_id as brandId',
  'p.unit_id as unitId',
  'un.name as unitName',
  'p.gst_rate_id as gstRateId',
  'p.purchase_price as purchasePrice',
  'p.description',
  'p.created_at as createdAt',
  'p.updated_at as updatedAt',
];

function baseQuery(warehouseId, trx = db) {
  return trx('products as p')
    .leftJoin('brands as b', 'b.id', 'p.brand_id')
    .leftJoin('categories as c', 'c.id', 'p.category_id')
    .join('units as un', 'un.id', 'p.unit_id')
    .leftJoin('gst_rates as g', 'g.id', 'p.gst_rate_id')
    .leftJoin('inventory as i', (j) =>
      j.on('i.product_id', 'p.id').andOnVal('i.warehouse_id', warehouseId),
    );
}

/** Matches the BRD search fields: name, SKU, part number, brand, machine model and HSN. */
function applySearch(query, search) {
  const term = `%${search}%`;
  query.where((q) =>
    q
      .whereILike('p.name', term)
      .orWhereILike('p.sku', term)
      .orWhereILike('p.part_number', term)
      .orWhereILike('p.machine_model', term)
      .orWhereILike('p.hsn_code', term)
      .orWhereILike('b.name', term),
  );
}

export const PRODUCT_SORT_FIELDS = {
  name: 'p.name',
  sku: 'p.sku',
  stock: 'i.quantity',
  sellingPrice: 'p.selling_price',
  createdAt: 'p.created_at',
};

export function list(warehouseId, filters) {
  const query = baseQuery(warehouseId).select(SUMMARY_COLUMNS);
  if (filters.search) applySearch(query, filters.search);
  if (filters.categoryId) {
    // Selecting a parent category also includes its sub-categories.
    query.where((q) =>
      q
        .where('p.category_id', filters.categoryId)
        .orWhereIn(
          'p.category_id',
          db('categories').select('id').where('parent_id', filters.categoryId),
        ),
    );
  }
  if (filters.brandId) query.where('p.brand_id', filters.brandId);
  if (filters.isActive !== undefined) query.where('p.is_active', filters.isActive);
  if (filters.stockStatus === 'out') query.whereRaw('COALESCE(i.quantity, 0) <= 0');
  if (filters.stockStatus === 'low') {
    query.whereRaw('COALESCE(i.quantity, 0) > 0 AND COALESCE(i.quantity, 0) <= p.min_stock_level');
  }
  if (filters.stockStatus === 'available') query.whereRaw('COALESCE(i.quantity, 0) > 0');
  return paginate(query, filters, PRODUCT_SORT_FIELDS, 'p.id');
}

/**
 * Fast search for the mobile search-first screen. Exact code matches rank first,
 * then prefix matches, then anything containing the term.
 */
export function quickSearch(warehouseId, search, limit) {
  const query = baseQuery(warehouseId).select(SUMMARY_COLUMNS).where('p.is_active', true);
  applySearch(query, search);
  return query
    .orderByRaw(
      `CASE
         WHEN upper(p.sku) = upper(?) OR upper(p.part_number) = upper(?) THEN 0
         WHEN p.name ILIKE ? OR p.sku ILIKE ? OR p.part_number ILIKE ? THEN 1
         ELSE 2
       END`,
      [search, search, `${search}%`, `${search}%`, `${search}%`],
    )
    .orderBy('p.name')
    .limit(limit);
}

export async function findById(id, warehouseId, trx = db) {
  return (await baseQuery(warehouseId, trx).where('p.id', id).first(DETAIL_COLUMNS)) ?? null;
}

function toRow(data) {
  const row = {};
  for (const [api, col] of Object.entries(WRITABLE)) {
    if (data[api] !== undefined) row[col] = data[api];
  }
  return row;
}

export async function create(data, userId, trx) {
  const [row] = await trx('products')
    .insert({ ...toRow(data), created_by: userId, updated_by: userId })
    .returning('id');
  return row.id;
}

export async function update(id, data, userId, trx) {
  await trx('products')
    .where({ id })
    .update({ ...toRow(data), updated_by: userId });
}

export async function createStockRows(productId, trx) {
  await trx.raw(
    `INSERT INTO inventory (warehouse_id, product_id, quantity)
     SELECT w.id, ?, 0 FROM warehouses w
     ON CONFLICT (warehouse_id, product_id) DO NOTHING`,
    [productId],
  );
}

/** True when any branch holds a non-whole quantity of the product. */
export async function hasFractionalStock(productId, trx) {
  const row = await trx('inventory')
    .where({ product_id: productId })
    .whereRaw('quantity <> trunc(quantity)')
    .first('id');
  return Boolean(row);
}

export async function hasHistory(id, trx) {
  const [txn, item] = await Promise.all([
    trx('inventory_transactions').where({ product_id: id }).first('id'),
    trx('invoice_items').where({ product_id: id }).first('id'),
  ]);
  return Boolean(txn || item);
}

export async function remove(id, trx) {
  await trx('inventory').where({ product_id: id }).del();
  await trx('products').where({ id }).del();
}
