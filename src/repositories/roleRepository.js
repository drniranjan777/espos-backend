import { db } from '../config/database.js';

const permissionsSubquery = (knex) =>
  knex.raw(`COALESCE((
    SELECT array_agg(p.code ORDER BY p.code)
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = r.id
  ), '{}') as permissions`);

export async function list() {
  return db('roles as r')
    .select(
      'r.id',
      'r.name',
      'r.description',
      'r.is_system as isSystem',
      db.raw('(SELECT count(*) FROM users u WHERE u.role_id = r.id)::int as "userCount"'),
      permissionsSubquery(db),
    )
    .orderBy('r.id');
}

export async function findById(id, trx = db) {
  const role = await trx('roles as r')
    .where('r.id', id)
    .first('r.id', 'r.name', 'r.description', 'r.is_system as isSystem', permissionsSubquery(trx));
  return role ?? null;
}

export async function listPermissions() {
  return db('permissions').select('id', 'code', 'module', 'description').orderBy(['module', 'code']);
}

export async function findPermissionIds(codes, trx = db) {
  if (!codes.length) return [];
  return trx('permissions').whereIn('code', codes).select('id', 'code');
}

export async function create(data, trx = db) {
  const [row] = await trx('roles').insert(data).returning('id');
  return row.id;
}

export async function update(id, data, trx = db) {
  await trx('roles').where({ id }).update(data);
}

export async function remove(id, trx = db) {
  await trx('roles').where({ id }).del();
}

export async function replacePermissions(roleId, permissionIds, trx) {
  await trx('role_permissions').where({ role_id: roleId }).del();
  if (permissionIds.length) {
    await trx('role_permissions').insert(
      permissionIds.map((permissionId) => ({ role_id: roleId, permission_id: permissionId })),
    );
  }
}

export async function countUsers(roleId, trx = db) {
  const row = await trx('users').where({ role_id: roleId }).count({ count: '*' }).first();
  return Number(row.count);
}
