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

const SEARCH_COLUMNS = [
  'p.name',
  'p.sku',
  'p.part_number',
  'p.machine_model',
  'p.hsn_code',
  'b.name',
];
const MAX_SEARCH_WORDS = 6;

/** Escapes LIKE wildcards so user input is matched literally. */
const likeTerm = (word) => `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Letters and digits only, upper-case: "320/04133" and "320-04133" both become "32004133". */
export const normalizeCode = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

// Part numbers and SKUs compared without separators, so spoken or differently typed
// codes ("320 04133", "32004133", "320-04133") match the stored "320/04133".
const CODE_COLUMNS = ['p.part_number', 'p.sku'];
const normalizedColumn = (column) =>
  `regexp_replace(upper(coalesce(${column}, '')), '[^A-Z0-9]', '', 'g')`;

function splitWords(search) {
  return search.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_WORDS);
}

/**
 * Matches the BRD search fields: name, SKU, part number, brand, machine model and HSN.
 * Every word must appear in at least one field, so "hydraulic 3dx" and a spoken
 * "JCB HF 001" both find their product.
 */
function applySearch(query, search) {
  for (const word of splitWords(search)) {
    const term = likeTerm(word);
    const code = normalizeCode(word);
    query.where((q) => {
      for (const column of SEARCH_COLUMNS) q.orWhereILike(column, term);
      // Words with digits may be (parts of) codes written with other separators.
      if (/\d/.test(code) && code.length >= 3) {
        for (const column of CODE_COLUMNS) {
          q.orWhereRaw(`${normalizedColumn(column)} LIKE ?`, [`%${code}%`]);
        }
      }
    });
  }
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
         WHEN ${normalizedColumn('p.sku')} = ? OR ${normalizedColumn('p.part_number')} = ? THEN 0
         WHEN p.name ILIKE ? OR p.sku ILIKE ? OR p.part_number ILIKE ? THEN 1
         ELSE 2
       END`,
      [normalizeCode(search), normalizeCode(search), `${search}%`, `${search}%`, `${search}%`],
    )
    .orderBy('p.name')
    .limit(limit);
}

// Minimum average similarity for "closest match" results (0-1, pg_trgm word_similarity).
const FUZZY_THRESHOLD = 0.4;

/**
 * Closest matches when no product contains every word, e.g. a misheard or misspelt
 * "hydrolic filtar". Each word is scored against the product's searchable text with
 * trigram word similarity and the average must reach FUZZY_THRESHOLD.
 */
export function fuzzySearch(warehouseId, search, limit) {
  const words = splitWords(search.toLowerCase());
  if (!words.length) return Promise.resolve([]);
  const doc = `lower(concat_ws(' ', p.name, p.sku, p.part_number, p.machine_model, b.name, c.name))`;
  const score = `((${words.map(() => `word_similarity(?, ${doc})`).join(' + ')}) / ${words.length})`;
  return baseQuery(warehouseId)
    .select(SUMMARY_COLUMNS)
    .where('p.is_active', true)
    .whereRaw(`${score} >= ?`, [...words, FUZZY_THRESHOLD])
    .orderByRaw(`${score} DESC`, words)
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
