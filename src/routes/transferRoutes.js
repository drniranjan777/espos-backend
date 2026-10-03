import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { requireAnyPermission, requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import * as transferService from '../services/transferService.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/apiResponse.js';
import { idParam } from '../validators/common.js';
import {
  listTransfersSchema,
  transferReasonSchema,
  transferRequestSchema,
} from '../validators/stockDocumentValidators.js';

export const transferRouter = Router();

const canView = requireAnyPermission(P.TRANSFER_REQUEST, P.TRANSFER_APPROVE, P.TRANSFER_RECEIVE);
const byId = validate({ params: idParam });

transferRouter.get('/', canView, validate({ query: listTransfersSchema }), async (req, res) =>
  sendPaginated(
    res,
    await transferService.list(req.validated.query, req.user, req.context.warehouseId),
  ),
);

transferRouter.get('/:id', canView, byId, async (req, res) =>
  sendSuccess(res, await transferService.getById(req.validated.params.id, req.user)),
);

transferRouter.post(
  '/',
  requirePermission(P.TRANSFER_REQUEST),
  validate({ body: transferRequestSchema }),
  async (req, res) => {
    const transfer = await transferService.request(req.validated.body, req.user, req.context);
    return sendCreated(res, transfer, `Transfer ${transfer.transferNo} requested`);
  },
);

transferRouter.post(
  '/:id/approve',
  requirePermission(P.TRANSFER_APPROVE),
  byId,
  async (req, res) => {
    const transfer = await transferService.approve(req.validated.params.id, req.user, req.context);
    return sendSuccess(res, transfer, { message: `${transfer.transferNo} approved and sent` });
  },
);

transferRouter.post(
  '/:id/reject',
  requirePermission(P.TRANSFER_APPROVE),
  validate({ params: idParam, body: transferReasonSchema }),
  async (req, res) => {
    const transfer = await transferService.reject(
      req.validated.params.id,
      req.validated.body,
      req.user,
      req.context,
    );
    return sendSuccess(res, transfer, { message: `${transfer.transferNo} rejected` });
  },
);

transferRouter.post(
  '/:id/receive',
  requirePermission(P.TRANSFER_RECEIVE),
  byId,
  async (req, res) => {
    const transfer = await transferService.receive(req.validated.params.id, req.user, req.context);
    return sendSuccess(res, transfer, { message: `${transfer.transferNo} received` });
  },
);

transferRouter.post(
  '/:id/cancel',
  requireAnyPermission(P.TRANSFER_REQUEST, P.TRANSFER_APPROVE),
  validate({ params: idParam, body: transferReasonSchema }),
  async (req, res) => {
    const transfer = await transferService.cancel(
      req.validated.params.id,
      req.validated.body,
      req.user,
      req.context,
    );
    return sendSuccess(res, transfer, { message: `${transfer.transferNo} cancelled` });
  },
);
