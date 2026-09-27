import { z } from 'zod';
import { email, gstin, optionalText, pincode, requiredText, stateCode } from './common.js';

const pan = z
  .string()
  .trim()
  .toUpperCase()
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null))
  .refine((v) => v == null || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), { message: 'Invalid PAN format' });

const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null))
  .refine((v) => v == null || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), { message: 'Invalid IFSC code' });

export const updateSettingsSchema = z
  .object({
    companyName: requiredText(200, 'Company name'),
    address: optionalText(1000),
    city: optionalText(100),
    pincode,
    phone: optionalText(30),
    email,
    gstin,
    pan,
    stateCode,
    bankName: optionalText(120),
    bankAccountName: optionalText(150),
    bankAccountNumber: z
      .string()
      .trim()
      .nullish()
      .transform((v) => (v === undefined ? undefined : v || null))
      .refine((v) => v == null || /^[0-9]{6,20}$/.test(v), {
        message: 'Account number must be 6-20 digits',
      }),
    bankIfsc: ifsc,
    bankBranch: optionalText(120),
    termsAndConditions: optionalText(3000),
    invoicePrefix: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, 'Invoice prefix is required')
      .max(10)
      .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers or dash'),
    invoiceNumberPadding: z.coerce.number().int().min(1).max(8),
  })
  .partial();
