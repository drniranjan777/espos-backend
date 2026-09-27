import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

// Friendly messages for named database constraints that users can realistically hit.
const CONSTRAINT_MESSAGES = {
  chk_inventory_non_negative: ['INSUFFICIENT_STOCK', 'Insufficient stock for this operation'],
  uq_products_sku: ['DUPLICATE', 'A product with this SKU already exists'],
  uq_users_username: ['DUPLICATE', 'This username is already taken'],
  uq_users_email: ['DUPLICATE', 'This email is already in use'],
  uq_customers_gstin: ['DUPLICATE', 'A customer with this GSTIN already exists'],
  uq_brands_name: ['DUPLICATE', 'A brand with this name already exists'],
  uq_units_code: ['DUPLICATE', 'A unit with this code already exists'],
  uq_categories_name_parent: ['DUPLICATE', 'A category with this name already exists'],
  gst_rates_rate_unique: ['DUPLICATE', 'This GST rate already exists'],
  roles_name_unique: ['DUPLICATE', 'A role with this name already exists'],
  adjustment_codes_code_unique: ['DUPLICATE', 'An adjustment code with this code already exists'],
};

/** Maps PostgreSQL errors to ApiErrors. Returns null for unexpected database errors. */
function fromDatabaseError(err) {
  const known = CONSTRAINT_MESSAGES[err.constraint];
  switch (err.code) {
    case '23505': // unique_violation
      return ApiError.conflict(known?.[1] ?? 'A record with these details already exists', 'DUPLICATE');
    case '23503': // foreign_key_violation
      return err.message.includes('update or delete')
        ? ApiError.conflict('This record is in use and cannot be deleted', 'IN_USE')
        : ApiError.badRequest('A referenced record does not exist');
    case '23514': // check_violation
      return known
        ? ApiError.conflict(known[1], known[0])
        : ApiError.badRequest('One or more values are not allowed');
    case '22P02': // invalid_text_representation
    case '22003': // numeric_value_out_of_range
      return ApiError.badRequest('One or more values have an invalid format or are out of range');
    default:
      return null;
  }
}

function normalize(err) {
  if (err instanceof ApiError) return err;
  if (err instanceof multer.MulterError) {
    return ApiError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message);
  }
  if (err.type === 'entity.parse.failed') return ApiError.badRequest('Malformed JSON body');
  if (err.type === 'entity.too.large') return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request is too large');
  if (typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) return fromDatabaseError(err);
  return null;
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, req, res, _next) {
  const apiError = normalize(err);

  if (!apiError || apiError.statusCode >= 500) {
    (req.log ?? logger).error({ err }, 'Unhandled error');
  }

  const status = apiError?.statusCode ?? 500;
  const body = {
    success: false,
    error: {
      code: apiError?.code ?? 'INTERNAL_ERROR',
      message: apiError?.message ?? 'Something went wrong. Please try again.',
    },
  };
  if (apiError?.details) body.error.details = apiError.details;
  if (!apiError && !env.isProduction) body.error.debug = err.message;

  res.status(status).json(body);
}
