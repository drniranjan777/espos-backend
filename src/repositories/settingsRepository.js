import { db } from '../config/database.js';

const SETTINGS_ID = 1;

const FIELDS = {
  companyName: 'company_name',
  logoPath: 'logo_path',
  address: 'address',
  city: 'city',
  pincode: 'pincode',
  phone: 'phone',
  email: 'email',
  gstin: 'gstin',
  pan: 'pan',
  state: 'state',
  stateCode: 'state_code',
  bankName: 'bank_name',
  bankAccountName: 'bank_account_name',
  bankAccountNumber: 'bank_account_number',
  bankIfsc: 'bank_ifsc',
  bankBranch: 'bank_branch',
  termsAndConditions: 'terms_and_conditions',
  invoicePrefix: 'invoice_prefix',
  invoiceNumberPadding: 'invoice_number_padding',
};

const COLUMNS = [
  ...Object.entries(FIELDS).map(([api, col]) => `${col} as ${api}`),
  'updated_at as updatedAt',
];

export async function get(trx = db) {
  return trx('company_settings').where({ id: SETTINGS_ID }).first(COLUMNS);
}

export async function update(data, userId, trx = db) {
  const row = { updated_by: userId };
  for (const [api, col] of Object.entries(FIELDS)) {
    if (data[api] !== undefined) row[col] = data[api];
  }
  await trx('company_settings').where({ id: SETTINGS_ID }).update(row);
}
