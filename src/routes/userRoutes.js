import { Router } from 'express';
import * as c from '../controllers/userController.js';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { requireAnyPermission, requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.js';
import {
  createRoleSchema,
  createUserSchema,
  listUsersSchema,
  roleSchema,
  updateUserSchema,
} from '../validators/userValidators.js';

export const userRouter = Router();

userRouter.use(requirePermission(P.USERS_MANAGE));
userRouter.get('/', validate({ query: listUsersSchema }), c.listUsers);
userRouter.post('/', validate({ body: createUserSchema }), c.createUser);
userRouter.get('/:id', validate({ params: idParam }), c.getUser);
userRouter.patch('/:id', validate({ params: idParam, body: updateUserSchema }), c.updateUser);

export const roleRouter = Router();

// Listing roles is needed on the user form, so users.manage is enough to read them.
roleRouter.get('/', requireAnyPermission(P.ROLES_MANAGE, P.USERS_MANAGE), c.listRoles);
roleRouter.get('/permissions', requirePermission(P.ROLES_MANAGE), c.listPermissions);
roleRouter.get('/:id', requirePermission(P.ROLES_MANAGE), validate({ params: idParam }), c.getRole);
roleRouter.post('/', requirePermission(P.ROLES_MANAGE), validate({ body: createRoleSchema }), c.createRole);
roleRouter.put(
  '/:id',
  requirePermission(P.ROLES_MANAGE),
  validate({ params: idParam, body: roleSchema }),
  c.updateRole,
);
roleRouter.delete('/:id', requirePermission(P.ROLES_MANAGE), validate({ params: idParam }), c.deleteRole);
