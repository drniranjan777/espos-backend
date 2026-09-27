import { z } from 'zod';
import { todayIso } from '../utils/date.js';
import { TRANSACTION_TYPES } from '../constants/transactionTypes.js';
import { LEDGER_SORT_FIELDS } from '../repositories/inventoryRepository.js';
import { listQuerySchema } from '../utils/pagination.js';
import { isoDate, money, optionalId, optionalText, quantity, requiredText } from './common.js';

/** Movement date: optional, defaults to today on the server, never in the future. */
const movementDate = isoDate
  .optional()
  .refine((v) => v === undefined || v <= todayIso(), { message: 'Date cannot be in the future' });

const productId = z.coerce.number({ error: 'Select a product' }).int().positive('Select a product');

export const stockInSchema = z.object({
  productId,
  quantity,
  purchasePrice: money.optional(),
  supplier: optionalText(150),
  reference: optionalText(100),
  date: movementDate,
  notes: optionalText(1000),
});

export const stockOutSchema = z.object({
  productId,
  quantity,
  customerId: optionalId,
  reason: optionalText(255),
  reference: optionalText(100),
  date: movementDate,
  notes: optionalText(1000),
});

export const adjustmentSchema = z
  .object({
    productId,
    adjustmentCodeId: z.coerce
      .number({ error: 'Select a reason' })
      .int()
      .positive('Select a reason'),
    mode: z.enum(['IN', 'OUT', 'SET']),
    // For SET this is the physical count and may be 0.
    quantity: z.coerce.number({ error: 'Quantity must be a number' }).min(0).max(99_999_999_999),
    reason: requiredText(255, 'Reason'),
    date: movementDate,
    notes: optionalText(1000),
  })
  .refine((d) => d.mode === 'SET' || d.quantity > 0, {
    path: ['quantity'],
    message: 'Quantity must be greater than 0',
  });

const typeList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((t) => t.trim().toUpperCase()) : undefined))
  .refine((v) => !v || v.every((t) => TRANSACTION_TYPES.includes(t)), {
    message: 'Unknown transaction type',
  });

export const ledgerQuerySchema = listQuerySchema(LEDGER_SORT_FIELDS, 'createdAt', {
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  productId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  types: typeList,
  from: isoDate.optional(),
  to: isoDate.optional(),
});
