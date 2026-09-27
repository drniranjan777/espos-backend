import * as productService from '../services/productService.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/apiResponse.js';

export async function list(req, res) {
  return sendPaginated(res, await productService.list(req.validated.query));
}

export async function search(req, res) {
  return sendSuccess(res, await productService.quickSearch(req.validated.query.q));
}

export async function get(req, res) {
  return sendSuccess(res, await productService.getById(req.validated.params.id));
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
