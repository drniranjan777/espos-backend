import { z } from 'zod';
import { PRODUCT_SORT_FIELDS } from '../repositories/productRepository.js';
import { listQuerySchema } from '../utils/pagination.js';
import { booleanQuery, money, optionalId, optionalText, requiredText } from './common.js';

const hsnCode = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null))
  .refine((v) => v == null || /^[0-9]{4,8}$/.test(v), {
    message: 'HSN code must be 4 to 8 digits',
  });

const productFields = {
  name: requiredText(200, 'Product name'),
  sku: requiredText(60, 'SKU')
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9\-_/.]*$/, 'SKU may contain letters, numbers, - _ / .'),
  partNumber: optionalText(80),
  categoryId: optionalId,
  brandId: optionalId,
  machineModel: optionalText(120),
  unitId: z.coerce.number({ error: 'Unit is required' }).int().positive('Unit is required'),
  hsnCode,
  purchasePrice: money.default(0),
  sellingPrice: money.default(0),
  mrp: money.default(0),
  gstRateId: optionalId,
  minStockLevel: z.coerce.number().min(0, 'Cannot be negative').max(99_999_999).default(0),
  description: optionalText(2000),
  isActive: z.boolean().optional(),
};

function pricesAreConsistent(data) {
  return (
    data.mrp == null || data.sellingPrice == null || data.mrp === 0 || data.sellingPrice <= data.mrp
  );
}

const priceRule = { path: ['sellingPrice'], message: 'Selling price cannot be higher than MRP' };

export const createProductSchema = z
  .object({
    ...productFields,
    openingStock: z.coerce.number().min(0, 'Cannot be negative').max(99_999_999).default(0),
  })
  .refine(pricesAreConsistent, priceRule);

// PATCH: every field optional and no defaults, so omitted fields are left unchanged.
// Opening stock can only be changed through stock adjustments.
export const updateProductSchema = z
  .object({
    ...productFields,
    purchasePrice: money,
    sellingPrice: money,
    mrp: money,
    minStockLevel: z.coerce.number().min(0).max(99_999_999),
  })
  .partial()
  .refine(pricesAreConsistent, priceRule);

export const listProductsSchema = listQuerySchema(PRODUCT_SORT_FIELDS, 'name', {
  categoryId: z.coerce.number().int().positive().optional(),
  brandId: z.coerce.number().int().positive().optional(),
  isActive: booleanQuery,
  stockStatus: z.enum(['available', 'low', 'out']).optional(),
});

export const quickSearchSchema = z.object({
  q: z.string().trim().min(1, 'Enter a search term').max(100),
});
