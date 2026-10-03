import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { ApiError } from '../utils/ApiError.js';
import { requireAnyPermission, requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import * as movementService from '../services/movementService.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/apiResponse.js';
import { idParam } from '../validators/common.js';
import { listMovementsSchema, movementSchema } from '../validators/stockDocumentValidators.js';

export const movementRouter = Router();

movementRouter.get(
  '/',
  requirePermission(P.INVENTORY_VIEW),
  validate({ query: listMovementsSchema }),
  async (req, res) =>
    sendPaginated(res, await movementService.list(req.validated.query, req.context.warehouseId)),
);

movementRouter.get(
  '/:id',
  requirePermission(P.INVENTORY_VIEW),
  validate({ params: idParam }),
  async (req, res) =>
    sendSuccess(
      res,
      await movementService.getById(req.validated.params.id, req.context.warehouseId),
    ),
);

// Stock IN needs inventory.in, Stock OUT needs inventory.out (checked after validation).
movementRouter.post(
  '/',
  requireAnyPermission(P.INVENTORY_IN, P.INVENTORY_OUT),
  validate({ body: movementSchema }),
  async (req, res) => {
    const needed = req.validated.body.type === 'IN' ? P.INVENTORY_IN : P.INVENTORY_OUT;
    if (!req.user.permissions.includes(needed)) throw ApiError.forbidden();
    const movement = await movementService.create(req.validated.body, req.context);
    return sendCreated(res, movement, `${movement.movementNo} saved`);
  },
);
