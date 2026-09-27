import { Router } from 'express';
import * as c from '../controllers/invoiceController.js';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.js';
import {
  cancelInvoiceSchema,
  createInvoiceSchema,
  invoiceSchema,
  listInvoicesSchema,
} from '../validators/invoiceValidators.js';

export const invoiceRouter = Router();

const byId = validate({ params: idParam });

invoiceRouter.get(
  '/',
  requirePermission(P.INVOICE_VIEW),
  validate({ query: listInvoicesSchema }),
  c.list,
);
invoiceRouter.get('/:id', requirePermission(P.INVOICE_VIEW), byId, c.get);
invoiceRouter.get('/:id/pdf', requirePermission(P.INVOICE_VIEW), byId, c.pdf);
invoiceRouter.post(
  '/',
  requirePermission(P.INVOICE_CREATE),
  validate({ body: createInvoiceSchema }),
  c.create,
);
invoiceRouter.put(
  '/:id',
  requirePermission(P.INVOICE_UPDATE),
  validate({ params: idParam, body: invoiceSchema }),
  c.update,
);
invoiceRouter.post('/:id/finalize', requirePermission(P.INVOICE_CREATE), byId, c.finalize);
invoiceRouter.post(
  '/:id/cancel',
  requirePermission(P.INVOICE_CANCEL),
  validate({ params: idParam, body: cancelInvoiceSchema }),
  c.cancel,
);
invoiceRouter.delete('/:id', requirePermission(P.INVOICE_UPDATE), byId, c.remove);
