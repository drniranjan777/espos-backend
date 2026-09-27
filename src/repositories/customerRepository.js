import { db } from '../config/database.js';
import { paginate } from '../utils/pagination.js';

const FIELDS = {
  name: 'name',
  companyName: 'company_name',
  mobile: 'mobile',
  email: 'email',
  gstin: 'gstin',
  billingAddress: 'billing_address',
  shippingAddress: 'shipping_address',
  state: 'state',
  stateCode: 'state_code',
  city: 'city',
  pincode: 'pincode',
  isActive: 'is_active',
};

const COLUMNS = [
  'c.id',
  ...Object.entries(FIELDS).map(([api, col]) => `c.${col} as ${api}`),
  'c.created_at as createdAt',
  'c.updated_at as updatedAt',
];

export const CUSTOMER_SORT_FIELDS = { name: 'c.name', createdAt: 'c.created_at', city: 'c.city' };

export function list(filters) {
  const query = db('customers as c').select(COLUMNS);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query.where((q) =>
      q
        .whereILike('c.name', term)
        .orWhereILike('c.company_name', term)
        .orWhereILike('c.mobile', term)
        .orWhereILike('c.gstin', term)
        .orWhereILike('c.city', term),
    );
  }
  if (filters.isActive !== undefined) query.where('c.is_active', filters.isActive);
  return paginate(query, filters, CUSTOMER_SORT_FIELDS, 'c.id');
}

export async function findById(id, trx = db) {
  return (await trx('customers as c').where('c.id', id).first(COLUMNS)) ?? null;
}

function toRow(data) {
  const row = {};
  for (const [api, col] of Object.entries(FIELDS)) {
    if (data[api] !== undefined) row[col] = data[api];
  }
  return row;
}

export async function create(data, userId, trx) {
  const [row] = await trx('customers')
    .insert({ ...toRow(data), created_by: userId, updated_by: userId })
    .returning('id');
  return row.id;
}

export async function update(id, data, userId, trx) {
  await trx('customers')
    .where({ id })
    .update({ ...toRow(data), updated_by: userId });
}

export async function hasHistory(id, trx) {
  const [invoice, txn] = await Promise.all([
    trx('invoices').where({ customer_id: id }).first('id'),
    trx('inventory_transactions').where({ customer_id: id }).first('id'),
  ]);
  return Boolean(invoice || txn);
}

export async function remove(id, trx) {
  await trx('customers').where({ id }).del();
}
