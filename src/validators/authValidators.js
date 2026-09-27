import { z } from 'zod';
import { password } from './common.js';

export const loginSchema = z.object({
  login: z.string().trim().min(1, 'Username is required').max(150),
  password: z.string().min(1, 'Password is required').max(200),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: password,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current password',
  });
