import * as customerService from '../services/customerService.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/apiResponse.js';

export async function list(req, res) {
  return sendPaginated(res, await customerService.list(req.validated.query));
}

export async function get(req, res) {
  return sendSuccess(res, await customerService.getById(req.validated.params.id));
}

export async function create(req, res) {
  return sendCreated(
    res,
    await customerService.create(req.validated.body, req.context),
    'Customer created',
  );
}

export async function update(req, res) {
  const customer = await customerService.update(
    req.validated.params.id,
    req.validated.body,
    req.context,
  );
  return sendSuccess(res, customer, { message: 'Customer updated' });
}

export async function remove(req, res) {
  await customerService.remove(req.validated.params.id, req.context);
  return sendSuccess(res, null, { message: 'Customer deleted' });
}
