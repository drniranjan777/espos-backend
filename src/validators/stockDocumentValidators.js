import { z } from 'zod';
import { MOVEMENT_SORT_FIELDS } from '../repositories/movementRepository.js';
import { todayIso } from '../utils/date.js';
import { listQuerySchema } from '../utils/pagination.js';
import { isoDate, optionalId, optionalText, quantity, requiredText } from './common.js';

const MAX_LINES = 200;

const lines = z
  .array(
    z.object({
      productId: z.coerce.number({ error: 'Select a product' }).int().positive(),
      quantity,
    }),
  )
  .min(1, 'Add at least one part')
  .max(MAX_LINES, `At most ${MAX_LINES} parts per entry`);

const pastOrToday = isoDate
  .optional()
  .refine((v) => v === undefined || v <= todayIso(), { message: 'Date cannot be in the future' });

export const movementSchema = z
  .object({
    type: z.enum(['IN', 'OUT']),
    noBill: z.boolean().default(false),
    invoiceNumber: optionalText(60),
    // OUT: customer from the master (optional); IN/OUT: name as typed (supplier for IN).
    customerId: optionalId,
    partyName: optionalText(150),
    note: optionalText(1000),
    date: pastOrToday,
    items: lines,
  })
  .superRefine((data, ctx) => {
    if (!data.noBill && !data.invoiceNumber) {
      ctx.addIssue({
        code: 'custom',
        path: ['invoiceNumber'],
        message: 'Enter the invoice number, or switch on "No bill"',
      });
    }
    if (data.type === 'IN' && data.customerId) {
      ctx.addIssue({
        code: 'custom',
        path: ['customerId'],
        message: 'Stock IN records a supplier name, not a customer',
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
