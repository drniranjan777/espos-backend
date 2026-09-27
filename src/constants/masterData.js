/** Reference data required in every environment (seeded idempotently). */

export const DEFAULT_WAREHOUSE = Object.freeze({
  code: 'MAIN',
  name: 'Main Warehouse',
});

export const DEFAULT_GST_RATES = [0, 5, 12, 18, 28];

/** BRD §12 adjustment reasons. */
export const DEFAULT_ADJUSTMENT_CODES = [
  { code: 'PHYSICAL_COUNT', name: 'Physical Count', direction: 'BOTH' },
  { code: 'DAMAGED', name: 'Damaged', direction: 'OUT' },
  { code: 'LOST', name: 'Lost', direction: 'OUT' },
  { code: 'FOUND', name: 'Found', direction: 'IN' },
  { code: 'RETURN', name: 'Return', direction: 'IN' },
  { code: 'SYSTEM_CORRECTION', name: 'System Correction', direction: 'BOTH' },
  { code: 'OPENING_STOCK', name: 'Opening Stock', direction: 'IN' },
  { code: 'OTHER', name: 'Other', direction: 'BOTH' },
];

export const DEFAULT_UNITS = [
  { name: 'Pieces', code: 'PCS', allow_decimal: false },
  { name: 'Numbers', code: 'NOS', allow_decimal: false },
  { name: 'Set', code: 'SET', allow_decimal: false },
  { name: 'Kit', code: 'KIT', allow_decimal: false },
  { name: 'Pair', code: 'PAIR', allow_decimal: false },
  { name: 'Box', code: 'BOX', allow_decimal: false },
  { name: 'Litre', code: 'LTR', allow_decimal: true },
  { name: 'Kilogram', code: 'KG', allow_decimal: true },
  { name: 'Metre', code: 'MTR', allow_decimal: true },
];

/** Indian states / UTs with GST state codes. */
export const INDIAN_STATES = [
  ['01', 'Jammu and Kashmir'],
  ['02', 'Himachal Pradesh'],
  ['03', 'Punjab'],
  ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'],
  ['06', 'Haryana'],
  ['07', 'Delhi'],
  ['08', 'Rajasthan'],
  ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'],
  ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'],
  ['14', 'Manipur'],
  ['15', 'Mizoram'],
  ['16', 'Tripura'],
  ['17', 'Meghalaya'],
  ['18', 'Assam'],
  ['19', 'West Bengal'],
  ['20', 'Jharkhand'],
  ['21', 'Odisha'],
  ['22', 'Chhattisgarh'],
  ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'],
  ['29', 'Karnataka'],
  ['30', 'Goa'],
  ['31', 'Lakshadweep'],
  ['32', 'Kerala'],
  ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
  ['97', 'Other Territory'],
].map(([code, name]) => ({ code, name }));

export const STATE_NAME_BY_CODE = Object.fromEntries(INDIAN_STATES.map((s) => [s.code, s.name]));
