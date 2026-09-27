import { db } from '../config/database.js';
import { paginate } from '../utils/pagination.js';

const PUBLIC_COLUMNS = [
  'u.id',
  'u.name',
  'u.username',
  'u.email',
  'u.mobile',
  'u.is_active as isActive',
  'u.last_login_at as lastLoginAt',
  'u.role_id as roleId',
  'r.name as roleName',
  'u.created_at as createdAt',
  'u.updated_at as updatedAt',
];

function baseQuery(trx = db) {
  return trx('users as u').join('roles as r', 'r.id', 'u.role_id');
}

export async function findAuthUserById(id) {
  const user = await baseQuery()
    .where('u.id', id)
    .first(
      ...PUBLIC_COLUMNS,
      db.raw(`COALESCE((
        SELECT array_agg(p.code ORDER BY p.code)
        FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = u.role_id
      ), '{}') as permissions`),
    );
  return user ?? null;
}

/** Looks a user up by username or email (case-insensitive). Includes the password hash. */
export async function findForLogin(login) {
  const value = login.toLowerCase();
  const user = await baseQuery()
    .where((q) =>
      q.whereRaw('lower(u.username) = ?', [value]).orWhereRaw('lower(u.email) = ?', [value]),
    )
    .first(...PUBLIC_COLUMNS, 'u.password_hash as passwordHash');
  return user ?? null;
}

export async function findById(id, trx = db) {
  return (
    (await baseQuery(trx)
      .where('u.id', id)
      .first(...PUBLIC_COLUMNS)) ?? null
  );
}

export async function findPasswordHash(id) {
  const row = await db('users').where({ id }).first('password_hash');
  return row?.password_hash ?? null;
}

export const USER_SORT_FIELDS = {
  name: 'u.name',
  username: 'u.username',
  createdAt: 'u.created_at',
  lastLoginAt: 'u.last_login_at',
};

export function list(filters) {
  const query = baseQuery().select(PUBLIC_COLUMNS);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query.where((q) =>
      q.whereILike('u.name', term).orWhereILike('u.username', term).orWhereILike('u.email', term),
    );
  }
  if (filters.roleId) query.where('u.role_id', filters.roleId);
  if (filters.isActive !== undefined) query.where('u.is_active', filters.isActive);
  return paginate(query, filters, USER_SORT_FIELDS, 'u.id');
}

export async function create(data, trx = db) {
  const [row] = await trx('users').insert(data).returning('id');
  return row.id;
}

export async function update(id, data, trx = db) {
  await trx('users').where({ id }).update(data);
}

export async function touchLastLogin(id) {
  await db('users').where({ id }).update({ last_login_at: db.fn.now() });
}

/** Number of active users holding the given role, excluding one user id. */
export async function countActiveWithRole(roleId, excludeUserId, trx = db) {
  const row = await trx('users')
    .where({ role_id: roleId, is_active: true })
    .whereNot('id', excludeUserId)
    .count({ count: '*' })
    .first();
  return Number(row.count);
}
