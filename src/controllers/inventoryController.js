import * as inventoryService from '../services/inventoryService.js';
import * as productService from '../services/productService.js';
import { sendCreated, sendPaginated } from '../utils/apiResponse.js';

/** Current stock list (products with quantities and stock-status filters). */
export async function stock(req, res) {
  return sendPaginated(
    res,
    await productService.list(req.validated.query, req.context.warehouseId),
  );
}

export async function stockIn(req, res) {
  return sendCreated(
    res,
    await inventoryService.stockIn(req.validated.body, req.context),
    'Stock added',
  );
}

export async function stockOut(req, res) {
  return sendCreated(
    res,
    await inventoryService.stockOut(req.validated.body, req.context),
    'Stock issued',
  );
}

export async function adjust(req, res) {
  return sendCreated(
    res,
    await inventoryService.adjust(req.validated.body, req.context),
    'Stock adjusted',
  );
}

export async function ledger(req, res) {
  return sendPaginated(
    res,
    await inventoryService.listLedger(req.validated.query, req.context.warehouseId),
  );
}
