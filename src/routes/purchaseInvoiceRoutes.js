import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import * as purchaseInvoiceService from '../services/purchaseInvoiceService.js';
import { sendPaginated, sendSuccess } from '../utils/apiResponse.js';
import { idParam } from '../validators/common.js';
import {
  listPurchaseInvoicesSchema,
  purchasePaymentSchema,
} from '../validators/stockDocumentValidators.js';

/** Billing (purchase) invoices of the current branch. They are created by Stock IN. */
export const purchaseInvoiceRouter = Router();

purchaseInvoiceRouter.get(
  '/',
  requirePermission(P.PURCHASE_VIEW),
  validate({ query: listPurchaseInvoicesSchema }),
  async (req, res) =>
    sendPaginated(
      res,
      await purchaseInvoiceService.list(req.validated.query, req.context.warehouseId),
    ),
);

purchaseInvoiceRouter.get(
  '/:id',
  requirePermission(P.PURCHASE_VIEW),
  validate({ params: idParam }),
  async (req, res) =>
    sendSuccess(
      res,
      await purchaseInvoiceService.getById(req.validated.params.id, req.context.warehouseId),
    ),
);

purchaseInvoiceRouter.patch(
  '/:id/payment',
  requirePermission(P.PURCHASE_VIEW, P.PURCHASE_PAY),
  validate({ params: idParam, body: purchasePaymentSchema }),
  async (req, res) => {
    const invoice = await purchaseInvoiceService.recordPayment(
      req.validated.params.id,
      req.validated.body.paidAmount,
      req.context,
    );
    return sendSuccess(res, invoice, { message: 'Payment saved' });
  },
);
