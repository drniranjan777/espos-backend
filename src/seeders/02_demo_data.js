/**
 * Development/demo data: extra users, catalogue, products with opening stock and customers.
 * Skipped in production and skipped if products already exist.
 */
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { TXN_TYPE } from '../constants/transactionTypes.js';

const DEMO_PASSWORD = 'Password@123';

const CATEGORIES = [
  'Hydraulics',
  'Filters',
  'Engine Parts',
  'Undercarriage',
  'Electricals',
  'Lubricants',
];
const BRANDS = ['JCB', 'CAT', 'Tata Hitachi', 'Komatsu', 'Escorts', 'Generic'];

// [name, sku, partNumber, category, brand, machineModel, unit, hsn, purchase, selling, mrp, gst, minStock, opening]
const PRODUCTS = [
  [
    'Hydraulic Filter',
    'JCB-HF-001',
    '32/925346',
    'Filters',
    'JCB',
    '3DX',
    'PCS',
    '84212300',
    620,
    850,
    950,
    18,
    10,
    42,
  ],
  [
    'Engine Oil Filter',
    'JCB-OF-002',
    '320/04133',
    'Filters',
    'JCB',
    '3DX Super',
    'PCS',
    '84212300',
    380,
    520,
    590,
    18,
    15,
    60,
  ],
  [
    'Fuel Filter',
    'JCB-FF-003',
    '32/925869',
    'Filters',
    'JCB',
    '4DX',
    'PCS',
    '84212300',
    290,
    410,
    460,
    18,
    15,
    8,
  ],
  [
    'Air Filter Outer',
    'JCB-AF-004',
    '32/925682',
    'Filters',
    'JCB',
    '3DX',
    'PCS',
    '84213100',
    950,
    1320,
    1450,
    18,
    5,
    18,
  ],
  [
    'Bucket Tooth',
    'JCB-BT-005',
    '531/03208',
    'Undercarriage',
    'JCB',
    '3DX',
    'PCS',
    '84314990',
    540,
    780,
    860,
    18,
    20,
    120,
  ],
  [
    'Hydraulic Pump Seal Kit',
    'JCB-SK-006',
    '991/00149',
    'Hydraulics',
    'JCB',
    '3DX Super',
    'KIT',
    '40169330',
    1150,
    1650,
    1800,
    18,
    5,
    4,
  ],
  [
    'Boom Cylinder Seal Kit',
    'JCB-SK-007',
    '991/00101',
    'Hydraulics',
    'JCB',
    '4DX',
    'KIT',
    '40169330',
    1400,
    1990,
    2200,
    18,
    5,
    12,
  ],
  [
    'Alternator 12V',
    'CAT-AL-008',
    '2871A302',
    'Electricals',
    'CAT',
    '424B',
    'PCS',
    '85115000',
    6800,
    8900,
    9800,
    28,
    2,
    6,
  ],
  [
    'Starter Motor',
    'CAT-SM-009',
    '2873K405',
    'Electricals',
    'CAT',
    '424B',
    'PCS',
    '85114000',
    8200,
    10900,
    11800,
    28,
    2,
    3,
  ],
  [
    'Track Roller',
    'KOM-TR-010',
    '20Y-30-00321',
    'Undercarriage',
    'Komatsu',
    'PC200',
    'PCS',
    '84314990',
    5200,
    7100,
    7800,
    18,
    4,
    16,
  ],
  [
    'Hydraulic Oil 68',
    'GEN-HO-011',
    'HO68-20L',
    'Lubricants',
    'Generic',
    'All Models',
    'LTR',
    '27101980',
    140,
    195,
    220,
    18,
    100,
    420,
  ],
  [
    'Grease EP2',
    'GEN-GR-012',
    'EP2-18KG',
    'Lubricants',
    'Generic',
    'All Models',
    'KG',
    '27101990',
    180,
    245,
    270,
    18,
    36,
    90,
  ],
  [
    'Piston Ring Set',
    'TH-PR-013',
    '4DX-PRS',
    'Engine Parts',
    'Tata Hitachi',
    'EX200',
    'SET',
    '84099199',
    2300,
    3150,
    3450,
    18,
    3,
    7,
  ],
  [
    'Water Pump',
    'ESC-WP-014',
    'WP-HYD-14',
    'Engine Parts',
    'Escorts',
    'Hydra 14',
    'PCS',
    '84133030',
    3100,
    4250,
    4600,
    18,
    3,
    0,
  ],
];

// [name, company, mobile, email, gstin, city, state, stateCode, pincode, address]
const CUSTOMERS = [
  [
    'Ramesh Patil',
    'Patil Earthmovers',
    '9876543210',
    'ramesh@patilearth.in',
    '27AAPFP1234C1Z5',
    'Pune',
    'Maharashtra',
    '27',
    '411001',
    'Plot 12, MIDC Bhosari, Pune',
  ],
  [
    'Suresh Kumar',
    'SK Infra Projects',
    '9812345678',
    'accounts@skinfra.in',
    '29AAKCS5678D1Z2',
    'Bengaluru',
    'Karnataka',
    '29',
    '560058',
    '45, Peenya Industrial Area, Bengaluru',
  ],
  [
    'Anil Sharma',
    null,
    '9900112233',
    null,
    null,
    'Nashik',
    'Maharashtra',
    '27',
    '422010',
    'Satpur MIDC, Nashik',
  ],
];

async function idMap(trx, table, column) {
  const rows = await trx(table).select('id', column);
  return Object.fromEntries(rows.map((r) => [String(r[column]), r.id]));
}

export async function seed(knex) {
  if (env.isProduction) return;
  const alreadySeeded = await knex('products').first('id');
  if (alreadySeeded) return;

  await knex.transaction(async (trx) => {
    const admin = await trx('users').where({ username: 'admin' }).first('id');
    const roles = await idMap(trx, 'roles', 'name');
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_ROUNDS);

    await trx('users')
      .insert([
        {
          name: 'Warehouse Staff',
          username: 'warehouse',
          password_hash: passwordHash,
          role_id: roles['Warehouse User'],
          created_by: admin.id,
        },
        {
          name: 'Sales Executive',
          username: 'salesman',
          password_hash: passwordHash,
          role_id: roles.Salesman,
          created_by: admin.id,
        },
      ])
      .onConflict()
      .ignore();

    await trx('categories').insert(CATEGORIES.map((name) => ({ name, created_by: admin.id })));
    await trx('brands').insert(BRANDS.map((name) => ({ name, created_by: admin.id })));

    const categories = await idMap(trx, 'categories', 'name');
    const brands = await idMap(trx, 'brands', 'name');
    const units = await idMap(trx, 'units', 'code');
    const gstRates = Object.fromEntries(
      (await trx('gst_rates').select('id', 'rate')).map((r) => [Number(r.rate), r.id]),
    );
    const warehouse = await trx('warehouses').where({ is_default: true }).first('id');

    for (const p of PRODUCTS) {
      const [
        name,
        sku,
        partNumber,
        category,
        brand,
        model,
        unit,
        hsn,
        purchase,
        selling,
        mrp,
        gst,
        minStock,
        opening,
      ] = p;
      const [product] = await trx('products')
        .insert({
          name,
          sku,
          part_number: partNumber,
          category_id: categories[category],
          brand_id: brands[brand],
          machine_model: model,
          unit_id: units[unit],
          hsn_code: hsn,
          purchase_price: purchase,
          selling_price: selling,
          mrp,
          gst_rate_id: gstRates[gst],
          min_stock_level: minStock,
          created_by: admin.id,
        })
        .returning('id');

      await trx('inventory').insert({
        warehouse_id: warehouse.id,
        product_id: product.id,
        quantity: opening,
      });
      if (opening > 0) {
        await trx('inventory_transactions').insert({
          warehouse_id: warehouse.id,
          product_id: product.id,
          type: TXN_TYPE.OPENING,
          quantity: opening,
          previous_balance: 0,
          new_balance: opening,
          unit_price: purchase,
          reason: 'Opening stock',
          created_by: admin.id,
        });
      }
    }

    await trx('customers').insert(
      CUSTOMERS.map(
        ([name, company, mobile, email, gstin, city, state, stateCode, pincode, address]) => ({
          name,
          company_name: company,
          mobile,
          email,
          gstin,
          city,
          state,
          state_code: stateCode,
          pincode,
          billing_address: address,
          shipping_address: address,
          created_by: admin.id,
        }),
      ),
    );

    await trx('company_settings').where({ id: 1 }).update({
      company_name: 'Shree Ganesh Machinery Spares',
      address: 'Shop 7, Transport Nagar, Nigdi',
      city: 'Pune',
      pincode: '411044',
      phone: '+91 98220 00000',
      email: 'sales@ganeshspares.in',
      gstin: '27ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      state: 'Maharashtra',
      state_code: '27',
      bank_name: 'State Bank of India',
      bank_account_name: 'Shree Ganesh Machinery Spares',
      bank_account_number: '000000000000',
      bank_ifsc: 'SBIN0000000',
      bank_branch: 'Nigdi, Pune',
      terms_and_conditions:
        '1. Goods once sold will not be taken back.\n2. Interest @18% p.a. will be charged on overdue bills.\n3. Subject to Pune jurisdiction.',
    });
  });
}
