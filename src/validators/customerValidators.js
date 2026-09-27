import { z } from 'zod';
import { CUSTOMER_SORT_FIELDS } from '../repositories/customerRepository.js';
import { listQuerySchema } from '../utils/pagination.js';
import {
  booleanQuery,
  email,
  gstin,
  mobile,
  optionalText,
  pincode,
  requiredText,
  stateCode,
} from './common.js';

// State name is derived from the state code on the server.
const customerFields = {
  name: requiredText(150, 'Customer name'),
  companyName: optionalText(150),
  mobile,
  email,
  gstin,
  billingAddress: optionalText(1000),
  shippingAddress: optionalText(1000),
  stateCode,
  city: optionalText(100),
  pincode,
  isActive: z.boolean().optional(),
};

export const createCustomerSchema = z.object(customerFields);
export const updateCustomerSchema = z.object(customerFields).partial();

export const listCustomersSchema = listQuerySchema(CUSTOMER_SORT_FIELDS, 'name', {
  isActive: booleanQuery,
});
