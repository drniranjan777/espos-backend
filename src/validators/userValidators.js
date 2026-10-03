import { z } from 'zod';
import { listQuerySchema } from '../utils/pagination.js';
import { USER_SORT_FIELDS } from '../repositories/userRepository.js';
import { booleanQuery, email, mobile, password, requiredText } from './common.js';

// Branches the user may work in (ignored for roles that can access every branch).
const branchIds = z.array(z.coerce.number().int().positive()).max(100);

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username must be at least 3 characters')
  .max(50)
  .regex(/^[a-z0-9._-]+$/, 'Use only letters, numbers, dot, dash or underscore');

export const createUserSchema = z.object({
  name: requiredText(120, 'Name'),
  username,
  email,
  mobile,
  password,
  roleId: z.coerce.number().int().positive({ error: 'Role is required' }),
  branchIds: branchIds.optional(),
});

export const updateUserSchema = z.object({
  name: requiredText(120, 'Name').optional(),
  username: username.optional(),
  email,
  mobile,
  // Optional admin password reset.
  password: password.optional(),
  roleId: z.coerce.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  branchIds: branchIds.optional(),
});

export const listUsersSchema = listQuerySchema(USER_SORT_FIELDS, 'name', {
  roleId: z.coerce.number().int().positive().optional(),
  isActive: booleanQuery,
});

export const roleSchema = z.object({
  name: requiredText(50, 'Role name'),
  description: z.string().trim().max(255).nullish(),
  permissions: z.array(z.string().max(60)).max(200).optional(),
});

export const createRoleSchema = roleSchema.extend({
  permissions: z.array(z.string().max(60)).max(200).default([]),
});
