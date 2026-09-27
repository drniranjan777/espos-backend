import { Router } from 'express';
import * as c from '../controllers/customerController.js';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { requireAnyPermission, requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.js';
import {
  createCustomerSchema,
  listCustomersSchema,
  updateCustomerSchema,
} from '../validators/customerValidators.js';

export const customerRouter = Router();

// Stock OUT lets users pick a customer, so inventory.out also grants read access.
const canView = requireAnyPermission(
  P.CUSTOMERS_VIEW,
  P.CUSTOMERS_MANAGE,
  P.INVENTORY_OUT,
  P.INVOICE_CREATE,
);
const canManage = requirePermission(P.CUSTOMERS_MANAGE);

customerRouter.get('/', canView, validate({ query: listCustomersSchema }), c.list);
customerRouter.get('/:id', canView, validate({ params: idParam }), c.get);
customerRouter.post('/', canManage, validate({ body: createCustomerSchema }), c.create);
customerRouter.patch(
  '/:id',
  canManage,
  validate({ params: idParam, body: updateCustomerSchema }),
  c.update,
);
customerRouter.delete('/:id', canManage, validate({ params: idParam }), c.remove);
