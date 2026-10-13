import { PERMISSIONS as P } from '../constants/permissions.js';
import { importProducts } from '../services/productImportService.js';
import * as productService from '../services/productService.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/apiResponse.js';

export async function list(req, res) {
  return sendPaginated(
    res,
    await productService.list(req.validated.query, req.context.warehouseId),
  );
}

export async function search(req, res) {
  return sendSuccess(
    res,
    await productService.quickSearch(req.validated.query.q, req.context.warehouseId, {
      withPurchasePrice: req.user.permissions.includes(P.PURCHASE_PRICE),
    }),
  );
}

export async function get(req, res) {
  return sendSuccess(
    res,
    await productService.getById(req.validated.params.id, req.context.warehouseId),
  );
}

export async function create(req, res) {
  return sendCreated(
    res,
    await productService.create(req.validated.body, req.context),
    'Product created',
  );
}

export async function update(req, res) {
  const product = await productService.update(
    req.validated.params.id,
    req.validated.body,
    req.context,
  );
  return sendSuccess(res, product, { message: 'Product updated' });
}

export async function remove(req, res) {
  await productService.remove(req.validated.params.id, req.context);
  return sendSuccess(res, null, { message: 'Product deleted' });
}

export async function importFromExcel(req, res) {
  const { rows, dryRun } = req.validated.body;
  return sendSuccess(
    res,
    await importProducts(rows, { dryRun }, req.context, req.user, req.branch),
  );
}
