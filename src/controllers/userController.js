import * as roleService from '../services/roleService.js';
import * as userService from '../services/userService.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/apiResponse.js';

export async function listUsers(req, res) {
  return sendPaginated(res, await userService.listUsers(req.validated.query));
}

export async function getUser(req, res) {
  return sendSuccess(res, await userService.getUser(req.validated.params.id));
}

export async function createUser(req, res) {
  return sendCreated(res, await userService.createUser(req.validated.body, req.context), 'User created');
}

export async function updateUser(req, res) {
  const user = await userService.updateUser(req.validated.params.id, req.validated.body, req.context);
  return sendSuccess(res, user, { message: 'User updated' });
}

export async function listRoles(_req, res) {
  return sendSuccess(res, await roleService.listRoles());
}

export async function listPermissions(_req, res) {
  return sendSuccess(res, await roleService.listPermissions());
}

export async function getRole(req, res) {
  return sendSuccess(res, await roleService.getRole(req.validated.params.id));
}

export async function createRole(req, res) {
  return sendCreated(res, await roleService.createRole(req.validated.body, req.context), 'Role created');
}

export async function updateRole(req, res) {
  const role = await roleService.updateRole(req.validated.params.id, req.validated.body, req.context);
  return sendSuccess(res, role, { message: 'Role updated' });
}

export async function deleteRole(req, res) {
  await roleService.deleteRole(req.validated.params.id, req.context);
  return sendSuccess(res, null, { message: 'Role deleted' });
}
