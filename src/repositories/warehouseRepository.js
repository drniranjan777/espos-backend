import { db } from '../config/database.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { ApiError } from '../utils/ApiError.js';

const FIELDS = {
  code: 'code',
  name: 'name',
  address: 'address',
  city: 'city',
  pincode: 'pincode',
  state: 'state',
  stateCode: 'state_code',
  phone: 'phone',
  gstin: 'gstin',
  isActive: 'is_active',
};

const COLUMNS = [
  'w.id',
  ...Object.entries(FIELDS).map(([api, col]) => `w.${col} as ${api}`),
  'w.is_default as isDefault',
  'w.created_at as createdAt',
  'w.updated_at as updatedAt',
];

/** The branch existing data belongs to; used when nothing else identifies a branch. */
export async function getDefaultWarehouseId(trx = db) {
  const row = await trx('warehouses').where({ is_default: true, is_active: true }).first('id');
  if (!row) throw new ApiError(500, 'NO_DEFAULT_WAREHOUSE', 'Default branch is not configured');
  return row.id;
}

/**
 * Active branches a user may work in: every branch with `branches.all`, otherwise the
 * assigned ones. The default branch is listed first.
 */
export async function listAccessibleBranches(userId, permissions, trx = db) {
  const query = trx('warehouses as w')
    .where('w.is_active', true)
    .select('w.id', 'w.code', 'w.name', 'w.is_default as isDefault')
    .orderBy([
      { column: 'w.is_default', order: 'desc' },
      { column: 'w.name', order: 'asc' },
    ]);
  if (!permissions.includes(PERMISSIONS.BRANCHES_ALL)) {
    query.whereExists(
      trx('warehouse_users as wu').whereRaw('wu.warehouse_id = w.id').where('wu.user_id', userId),
    );
  }
  return query;
}

export async function list({ search, isActive } = {}) {
  const query = db('warehouses as w')
    .select(
      COLUMNS,
      db.raw(
        '(SELECT count(*) FROM warehouse_users wu WHERE wu.warehouse_id = w.id)::int as "userCount"',
      ),
    )
    .orderBy([
      { column: 'w.is_default', order: 'desc' },
      { column: 'w.name', order: 'asc' },
    ]);
  if (isActive !== undefined) query.where('w.is_active', isActive);
  if (search) {
    query.where((q) => q.whereILike('w.name', `%${search}%`).orWhereILike('w.code', `%${search}%`));
  }
  return query;
}

export async function findById(id, trx = db) {
  return (await trx('warehouses as w').where('w.id', id).first(COLUMNS)) ?? null;
}

function toRow(data) {
  const row = {};
  for (const [api, col] of Object.entries(FIELDS)) {
    if (data[api] !== undefined) row[col] = data[api];
  }
  return row;
}

export async function create(data, userId, trx) {
  const [row] = await trx('warehouses')
    .insert({ ...toRow(data), created_by: userId, updated_by: userId })
    .returning('id');
  // A stock row for every product keeps branch stock queries simple and complete.
  await trx.raw(
    `INSERT INTO inventory (warehouse_id, product_id, quantity)
     SELECT ?, p.id, 0 FROM products p
     ON CONFLICT (warehouse_id, product_id) DO NOTHING`,
    [row.id],
  );
  return row.id;
}

export async function update(id, data, userId, trx) {
  await trx('warehouses')
    .where({ id })
    .update({ ...toRow(data), updated_by: userId });
}

export async function hasStock(id, trx) {
  const row = await trx('inventory')
    .where({ warehouse_id: id })
    .where('quantity', '>', 0)
    .first('id');
  return Boolean(row);
}

export async function hasOpenTransfers(id, trx) {
  const row = await trx('stock_transfers')
    .whereIn('status', ['REQUESTED', 'IN_TRANSIT'])
    .where((q) => q.where('from_warehouse_id', id).orWhere('to_warehouse_id', id))
    .first('id');
  return Boolean(row);
}

// ---- User ↔ branch assignment ----

export async function branchIdsForUser(userId, trx = db) {
  const rows = await trx('warehouse_users').where({ user_id: userId }).select('warehouse_id');
  return rows.map((r) => r.warehouse_id);
}

export async function setUserBranches(userId, warehouseIds, trx) {
  await trx('warehouse_users').where({ user_id: userId }).del();
  if (warehouseIds.length) {
    await trx('warehouse_users').insert(
      warehouseIds.map((warehouseId) => ({ warehouse_id: warehouseId, user_id: userId })),
    );
  }
}

export async function countExisting(ids, trx = db) {
  if (!ids.length) return 0;
  const row = await trx('warehouses').whereIn('id', ids).count({ count: '*' }).first();
  return Number(row.count);
}
