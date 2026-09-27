import { z } from 'zod';
import { todayIso } from '../utils/date.js';
import { INVOICE_SORT_FIELDS } from '../repositories/invoiceRepository.js';
import { listQuerySchema } from '../utils/pagination.js';
import { isoDate, money, optionalText, quantity, requiredText, stateCode } from './common.js';

const MAX_ITEMS = 200;

const itemSchema = z.object({
  productId: z.coerce.number({ error: 'Select a product' }).int().positive('Select a product'),
  quantity,
  // Defaults to the product selling price when omitted.
  rate: money.optional(),
  discountPercent: z.coerce
    .number()
    .min(0, 'Cannot be negative')
    .max(100, 'Cannot exceed 100')
    .default(0),
});

export const invoiceSchema = z.object({
  customerId: z.coerce.number({ error: 'Select a customer' }).int().positive('Select a customer'),
  invoiceDate: isoDate
    .default(() => todayIso())
    .refine((v) => v <= todayIso(), { message: 'Invoice date cannot be in the future' }),
  placeOfSupplyStateCode: stateCode,
  shippingAddress: optionalText(1000),
  notes: optionalText(1000),
  items: z
    .array(itemSchema)
    .min(1, 'Add at least one item')
    .max(MAX_ITEMS, `At most ${MAX_ITEMS} items`),
});

export const createInvoiceSchema = invoiceSchema.extend({
  // Create and finalize in one step (the common mobile flow).
  finalize: z.boolean().default(false),
});

export const cancelInvoiceSchema = z.object({
  reason: requiredText(255, 'Cancellation reason'),
});

export const listInvoicesSchema = listQuerySchema(INVOICE_SORT_FIELDS, 'createdAt', {
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  status: z.enum(['DRAFT', 'FINAL', 'CANCELLED']).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
