import bcrypt from 'bcryptjs';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import * as refreshTokenRepository from '../repositories/refreshTokenRepository.js';
import * as roleRepository from '../repositories/roleRepository.js';
import * as userRepository from '../repositories/userRepository.js';
import { ApiError } from '../utils/ApiError.js';
import * as auditService from './auditService.js';

export const listUsers = (filters) => userRepository.list(filters);

export async function getUser(id) {
  const user = await userRepository.findById(id);
  if (!user) throw ApiError.notFound('User');
  return user;
}

async function assertRoleExists(roleId, trx) {
  if (!(await roleRepository.findById(roleId, trx))) {
    throw ApiError.badRequest('Selected role does not exist');
  }
}

export async function createUser({ password, roleId, ...data }, context) {
  return db.transaction(async (trx) => {
    await assertRoleExists(roleId, trx);
    const id = await userRepository.create(
      {
        ...data,
        role_id: roleId,
        password_hash: await bcrypt.hash(password, env.BCRYPT_ROUNDS),
        created_by: context.userId,
        updated_by: context.userId,
      },
      trx,
    );
    const user = await userRepository.findById(id, trx);
    await auditService.log(
      context,
      { action: AUDIT_ACTION.CREATE, module: AUDIT_MODULE.USERS, recordId: id, newValue: user },
      trx,
    );
    return user;
  });
}

/**
 * Updates a user. Guards against lock-out: you cannot deactivate yourself, and the last
 * active user of the system (Admin) role cannot be deactivated or moved to another role.
 */
export async function updateUser(id, { password, roleId, isActive, ...data }, context) {
  return db.transaction(async (trx) => {
    const before = await userRepository.findById(id, trx);
    if (!before) throw ApiError.notFound('User');

    if (id === context.userId && isActive === false) {
      throw ApiError.badRequest('You cannot deactivate your own account');
    }
    if (roleId !== undefined) await assertRoleExists(roleId, trx);

    const currentRole = await roleRepository.findById(before.roleId, trx);
    const leavesSystemRole =
      currentRole.isSystem &&
      before.isActive &&
      ((roleId !== undefined && roleId !== before.roleId) || isActive === false);
    if (leavesSystemRole && (await userRepository.countActiveWithRole(before.roleId, id, trx)) === 0) {
      throw ApiError.badRequest(`At least one active ${currentRole.name} user is required`);
    }

    const changes = { ...data, updated_by: context.userId };
    if (roleId !== undefined) changes.role_id = roleId;
    if (isActive !== undefined) changes.is_active = isActive;
    if (password) changes.password_hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    await userRepository.update(id, changes, trx);

    // Force re-login when access is revoked or the password is reset by an admin.
    if (isActive === false || password) await refreshTokenRepository.revokeAllForUser(id, trx);

    const after = await userRepository.findById(id, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.UPDATE,
        module: AUDIT_MODULE.USERS,
        recordId: id,
        oldValue: before,
        newValue: password ? { ...after, passwordReset: true } : after,
      },
      trx,
    );
    return after;
  });
}
