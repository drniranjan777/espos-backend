import * as inventoryService from '../services/inventoryService.js';
import * as productService from '../services/productService.js';
import { canViewPurchasePrice, omit } from '../utils/access.js';
import { sendCreated, sendPaginated } from '../utils/apiResponse.js';

/** The price on a Stock IN ledger row is a purchase price: Admin only. */
const hidePrice = (row, user) => (canViewPurchasePrice(user) ? row : omit(row, 'unitPrice'));

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
    hidePrice(await inventoryService.stockIn(req.validated.body, req.context), req.user),
    'Stock added',
  );
}

export async function stockOut(req, res) {
  return sendCreated(
    res,
    hidePrice(await inventoryService.stockOut(req.validated.body, req.context), req.user),
    'Stock issued',
  );
}

export async function adjust(req, res) {
  return sendCreated(
    res,
    hidePrice(await inventoryService.adjust(req.validated.body, req.context), req.user),
    'Stock adjusted',
  );
}

export async function ledger(req, res) {
  const page = await inventoryService.listLedger(req.validated.query, req.context.warehouseId);
  return sendPaginated(res, { ...page, items: page.items.map((row) => hidePrice(row, req.user)) });
}
