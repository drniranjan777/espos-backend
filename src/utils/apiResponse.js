export function sendSuccess(res, data, { status = 200, meta, message } = {}) {
  const body = { success: true, data };
  if (message) body.message = message;
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export function sendCreated(res, data, message) {
  return sendSuccess(res, data, { status: 201, message });
}

export function sendPaginated(res, { items, total, page, limit }) {
  return sendSuccess(res, items, {
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
}
