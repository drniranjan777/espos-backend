import { z } from 'zod';

/**
 * Normalises optional input: '' / null become null (clears the column), while undefined stays
 * undefined so PATCH requests leave omitted fields untouched.
 */
const emptyToNull = (v) => (v === undefined ? undefined : v || null);

export const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Optional trimmed string; empty strings become null so they clear the column. */
export const optionalText = (max) => z.string().trim().max(max).nullish().transform(emptyToNull);

export const requiredText = (max, label = 'This field') =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max);

export const money = z.coerce
  .number({ error: 'Must be a number' })
  .min(0, 'Cannot be negative')
  .max(999_999_999_999, 'Value is too large')
  .transform((v) => Math.round(v * 100) / 100);

export const quantity = z.coerce
  .number({ error: 'Quantity must be a number' })
  .positive('Quantity must be greater than 0')
  .max(99_999_999_999, 'Quantity is too large')
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, {
    message: 'Quantity supports up to 3 decimal places',
  });

export const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const isoDate = z.iso.date({ error: 'Use the format YYYY-MM-DD' });

export const optionalId = z.coerce.number().int().positive().nullish();

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const STATE_CODE_REGEX = /^[0-9]{2}$/;

export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .nullish()
  .transform(emptyToNull)
  .refine((v) => v == null || GSTIN_REGEX.test(v), { message: 'Invalid GSTIN format' });

export const stateCode = z
  .string()
  .trim()
  .nullish()
  .transform(emptyToNull)
  .refine((v) => v == null || STATE_CODE_REGEX.test(v), { message: 'State code must be 2 digits' });

export const mobile = z
  .string()
  .trim()
  .nullish()
  .transform((v) => emptyToNull(v?.replace(/[\s-]/g, '')))
  .refine((v) => v == null || /^(\+91)?[6-9][0-9]{9}$/.test(v), {
    message: 'Enter a valid 10-digit mobile number',
  });

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform(emptyToNull)
  .refine((v) => v == null || z.email().safeParse(v).success, { message: 'Enter a valid email' });

export const pincode = z
  .string()
  .trim()
  .nullish()
  .transform(emptyToNull)
  .refine((v) => v == null || /^[1-9][0-9]{5}$/.test(v), { message: 'Pincode must be 6 digits' });

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');
