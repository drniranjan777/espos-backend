import { z } from 'zod';
import { booleanQuery, optionalId, optionalText, requiredText } from './common.js';

export const masterListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  isActive: booleanQuery,
});

const isActive = z.boolean().optional();

export const categorySchema = z.object({
  name: requiredText(100, 'Name'),
  parentId: optionalId,
  description: optionalText(255),
  isActive,
});

export const brandSchema = z.object({
  name: requiredText(100, 'Name'),
  isActive,
});

export const unitSchema = z.object({
  name: requiredText(50, 'Name'),
  code: requiredText(10, 'Code').toUpperCase(),
  allowDecimal: z.boolean().optional(),
  isActive,
});

export const gstRateCreateSchema = z.object({
  name: requiredText(50, 'Name'),
  rate: z.coerce.number().min(0, 'Rate cannot be negative').max(100, 'Rate cannot exceed 100'),
  isActive,
});

// The rate itself is immutable: products and invoices depend on it. Create a new rate instead.
export const gstRateUpdateSchema = gstRateCreateSchema.omit({ rate: true }).partial();

const direction = z.enum(['IN', 'OUT', 'BOTH']);

export const adjustmentCodeCreateSchema = z.object({
  code: requiredText(30, 'Code')
    .toUpperCase()
    .regex(/^[A-Z0-9_]+$/, 'Use capital letters, numbers and underscores'),
  name: requiredText(80, 'Name'),
  direction,
  isActive,
});

export const adjustmentCodeUpdateSchema = adjustmentCodeCreateSchema.omit({ code: true }).partial();
