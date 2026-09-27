import { db } from '../config/database.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import * as roleRepository from '../repositories/roleRepository.js';
import { ApiError } from '../utils/ApiError.js';
import * as auditService from './auditService.js';

export const listRoles = () => roleRepository.list();
export const listPermissions = () => roleRepository.listPermissions();

export async function getRole(id) {
  const role = await roleRepository.findById(id);
  if (!role) throw ApiError.notFound('Role');
  return role;
}

async function resolvePermissionIds(codes, trx) {
  const unique = [...new Set(codes)];
  const rows = await roleRepository.findPermissionIds(unique, trx);
  if (rows.length !== unique.length) {
    const known = new Set(rows.map((r) => r.code));
    throw ApiError.badRequest(`Unknown permissions: ${unique.filter((c) => !known.has(c)).join(', ')}`);
  }
  return rows.map((r) => r.id);
}

export async function createRole({ name, description, permissions }, context) {
  return db.transaction(async (trx) => {
    const id = await roleRepository.create({ name, description }, trx);
    await roleRepository.replacePermissions(id, await resolvePermissionIds(permissions, trx), trx);
    const role = await roleRepository.findById(id, trx);
    await auditService.log(
      context,
      { action: AUDIT_ACTION.CREATE, module: AUDIT_MODULE.ROLES, recordId: id, newValue: role },
      trx,
    );
    return role;
  });
}

export async function updateRole(id, { name, description, permissions }, context) {
  return db.transaction(async (trx) => {
    const before = await roleRepository.findById(id, trx);
    if (!before) throw ApiError.notFound('Role');
    // The system (Admin) role keeps its name and full permission set so nobody gets locked out.
    if (before.isSystem && (name !== before.name || permissions !== undefined)) {
      throw ApiError.badRequest('The Admin role name and permissions cannot be changed');
    }

    await roleRepository.update(id, { name, description }, trx);
    if (permissions !== undefined) {
      await roleRepository.replacePermissions(id, await resolvePermissionIds(permissions, trx), trx);
    }
    const after = await roleRepository.findById(id, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.UPDATE,
        module: AUDIT_MODULE.ROLES,
        recordId: id,
        oldValue: before,
        newValue: after,
      },
      trx,
    );
    return after;
  });
}

export async function deleteRole(id, context) {
  return db.transaction(async (trx) => {
    const role = await roleRepository.findById(id, trx);
    if (!role) throw ApiError.notFound('Role');
    if (role.isSystem) throw ApiError.badRequest('System roles cannot be deleted');
    if ((await roleRepository.countUsers(id, trx)) > 0) {
      throw ApiError.conflict('Reassign the users of this role before deleting it', 'IN_USE');
    }
    await roleRepository.remove(id, trx);
    await auditService.log(
      context,
      { action: AUDIT_ACTION.DELETE, module: AUDIT_MODULE.ROLES, recordId: id, oldValue: role },
      trx,
    );
  });
}
