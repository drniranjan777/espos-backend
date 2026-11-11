import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { ApiError } from '../utils/ApiError.js';
import { canViewPurchasePrice, omit } from '../utils/access.js';
import { requireAnyPermission, requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import * as movementService from '../services/movementService.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/apiResponse.js';
import { idParam } from '../validators/common.js';
import { listMovementsSchema, movementSchema } from '../validators/stockDocumentValidators.js';

export const movementRouter = Router();

/** Purchase prices on the lines are Admin-only. */
function present(movement, user) {
  if (canViewPurchasePrice(user)) return movement;
  return {
    ...movement,
    items: movement.items.map((item) => omit(item, 'purchasePrice', 'previousPurchasePrice')),
  };
}

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
      present(
        await movementService.getById(req.validated.params.id, req.context.warehouseId),
        req.user,
      ),
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
    const pricesEntered = req.validated.body.items.some((item) => item.purchasePrice !== undefined);
    if (pricesEntered && !canViewPurchasePrice(req.user)) {
      throw ApiError.forbidden('You do not have permission to change purchase prices');
    }
    const created = await movementService.create(req.validated.body, req.context);
    const movement = present(created.movement, req.user);
    if (created.duplicate) {
      return sendSuccess(res, movement, { message: `${movement.movementNo} was already saved` });
    }
    return sendCreated(res, movement, `${movement.movementNo} saved`);
  },
);
