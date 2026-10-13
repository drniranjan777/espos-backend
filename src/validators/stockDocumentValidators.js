import { z } from 'zod';
import { MOVEMENT_SORT_FIELDS } from '../repositories/movementRepository.js';
import { PURCHASE_INVOICE_SORT_FIELDS } from '../repositories/purchaseInvoiceRepository.js';
import { todayIso } from '../utils/date.js';
import { listQuerySchema } from '../utils/pagination.js';
import { isoDate, money, optionalId, optionalText, quantity, requiredText } from './common.js';

const MAX_LINES = 200;

const productId = z.coerce.number({ error: 'Select a product' }).int().positive();

const lineList = (line) =>
  z
    .array(z.object(line))
    .min(1, 'Add at least one part')
    .max(MAX_LINES, `At most ${MAX_LINES} parts per entry`);

const lines = lineList({ productId, quantity });
// Stock IN lines may carry the purchase price paid; without it the current price is used.
const movementLines = lineList({ productId, quantity, purchasePrice: money.optional() });

const pastOrToday = isoDate
  .optional()
  .refine((v) => v === undefined || v <= todayIso(), { message: 'Date cannot be in the future' });

export const movementSchema = z
  .object({
    type: z.enum(['IN', 'OUT']),
    noBill: z.boolean().default(false),
    invoiceNumber: optionalText(60),
    // Customer from the master (optional); partyName defaults to the customer's name.
    customerId: optionalId,
    partyName: optionalText(150),
    note: optionalText(1000),
    date: pastOrToday,
    // Sent by the screen so a repeated submit returns the entry already saved.
    clientRequestId: z.uuid().optional(),
    items: movementLines,
  })
  .superRefine((data, ctx) => {
    if (data.type === 'OUT' && data.items.some((item) => item.purchasePrice !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Purchase prices apply to Stock IN only',
      });
    }
    if (!data.noBill && !data.invoiceNumber) {
      ctx.addIssue({
        code: 'custom',
        path: ['invoiceNumber'],
        message: 'Enter the invoice number, or switch on "No bill"',
      });
    }
  });

export const listMovementsSchema = listQuerySchema(MOVEMENT_SORT_FIELDS, 'createdAt', {
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  type: z.enum(['IN', 'OUT']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// ---- Transfers ----

export const transferRequestSchema = z.object({
  toWarehouseId: z.coerce.number({ error: 'Select the branch to transfer to' }).int().positive(),
  invoiceNumber: optionalText(60),
  note: optionalText(1000),
  items: lines,
});

export const transferReasonSchema = z.object({
  reason: requiredText(255, 'Reason'),
});

export const TRANSFER_STATUSES = ['REQUESTED', 'IN_TRANSIT', 'RECEIVED', 'REJECTED', 'CANCELLED'];

export const listTransfersSchema = listQuerySchema({ createdAt: 't.id' }, 'createdAt', {
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim().toUpperCase()) : undefined))
    .refine((v) => !v || v.every((s) => TRANSFER_STATUSES.includes(s)), {
      message: 'Unknown status',
    }),
  // outgoing: from this branch, incoming: to this branch, all: both (default).
  direction: z.enum(['all', 'outgoing', 'incoming']).default('all'),
  // Approvers may list transfers of every branch.
  scope: z.enum(['branch', 'everywhere']).default('branch'),
});

// ---- Billing (purchase) invoices ----

export const listPurchaseInvoicesSchema = listQuerySchema(
  PURCHASE_INVOICE_SORT_FIELDS,
  'createdAt',
  {
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    from: isoDate.optional(),
    to: isoDate.optional(),
    paymentStatus: z.enum(['UNPAID', 'PARTIAL', 'PAID']).optional(),
    supplierId: z.coerce.number().int().positive().optional(),
  },
);

export const purchasePaymentSchema = z.object({ paidAmount: money });
