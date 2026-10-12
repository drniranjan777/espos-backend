import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, SALESMAN, WAREHOUSE, as } from '../helpers/api.js';
import { db, resetDatabase } from '../helpers/db.js';

// Demo seed: branches Hyderabad (1, default) and Vijayawada (2); SKU JCB-HF-001 exists.
let admin;

const row = (rowNumber, values) => ({ rowNumber, ...values });
const idler = row(2, {
  name: 'PC200 Idler 6 Hole',
  sku: 'itr-idl-200',
  partNumber: '20Y-30-00030',
  category: 'Undercarriage',
  brand: 'ITR',
  machineModel: 'PC200',
  unit: 'pcs',
  hsnCode: 84314990,
  purchasePrice: 18500,
  sellingPrice: '24,000',
  mrp: 26000,
  gstRate: '18%',
  minStockLevel: 2,
  openingStock: 6,
  branch: '',
  description: null,
});
const idlerInVijayawada = row(3, { sku: 'ITR-IDL-200', branch: 'Vijayawada', openingStock: 4 });
const coolant = row(4, {
  name: 'Coolant',
  sku: 'GEN-CL-001',
  category: 'Coolants',
  unit: 'LTR',
  openingStock: 12.5,
  branch: 'HYD',
});

const send = (client, rows, dryRun) => client.post('/products/import', { rows, dryRun });

async function stockOf(sku, branchId) {
  const res = await admin
    .get(`/products?search=${encodeURIComponent(sku)}`)
    .set('X-Branch-Id', String(branchId));
  return res.body.data.find((p) => p.sku === sku)?.stockQuantity;
}

beforeAll(async () => {
  await resetDatabase();
  admin = await as(ADMIN);
});
afterAll(() => db.destroy());

describe('POST /products/import', () => {
  it('needs permission to create parts', async () => {
    const salesman = await as(SALESMAN);
    const warehouse = await as(WAREHOUSE);
    expect((await send(salesman, [idler], true)).status).toBe(403);
    expect((await send(warehouse, [idler], true)).status).toBe(403);
    expect((await send(admin, [], true)).status).toBe(422);
  });

  it('checks a file without saving anything', async () => {
    const res = await send(admin, [idler, idlerInVijayawada, coolant], true);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      imported: false,
      totalRows: 3,
      partsToCreate: 2,
      partsWithStock: 2,
      defaultBranch: 'Hyderabad',
      newCategories: ['Coolants'],
      newBrands: ['ITR'],
      skipped: [],
      errors: [],
    });
    expect(await stockOf('ITR-IDL-200', 1)).toBeUndefined();
    // Leaving dryRun out also only checks.
    await admin.post('/products/import', { rows: [coolant] });
    expect(await stockOf('GEN-CL-001', 1)).toBeUndefined();
  });

  it('reports problems by Excel row and column', async () => {
    const rows = [
      row(2, { name: '', sku: 'BAD-1', unit: 'PCS' }),
      row(3, { name: 'No unit', sku: 'BAD-2' }),
      row(4, { name: 'Odd unit', sku: 'BAD-3', unit: 'DOZEN' }),
      row(5, { name: 'Price', sku: 'BAD-4', unit: 'PCS', sellingPrice: 900, mrp: 800 }),
      row(6, { name: 'Half piece', sku: 'BAD-5', unit: 'PCS', openingStock: 2.5 }),
      row(7, { name: 'Text', sku: 'BAD-6', unit: 'PCS', purchasePrice: 'abc', gstRate: 7 }),
      row(8, { name: 'Branch', sku: 'BAD-7', unit: 'PCS', branch: 'Chennai' }),
      row(9, { name: 'Spaces', sku: 'BAD 8', unit: 'PCS' }),
      row(10, { name: 'No sku', unit: 'PCS' }),
      row(11, { name: 'Twice', sku: 'BAD-9', unit: 'PCS', openingStock: 1 }),
      row(12, { sku: 'BAD-9', openingStock: 2 }),
      row(13, { name: 'HSN', sku: 'BAD-10', unit: 'PCS', hsnCode: '12' }),
    ];
    const { errors, partsToCreate } = (await send(admin, rows, true)).body.data;
    const problem = (n) => errors.filter((e) => e.row === n).map((e) => e.field);
    expect(problem(2)).toEqual(['name']);
    expect(problem(3)).toEqual(['unit']);
    expect(problem(4)).toEqual(['unit']);
    expect(problem(5)).toEqual(['sellingPrice']);
    expect(problem(6)).toEqual(['openingStock']);
    expect(problem(7)).toEqual(['purchasePrice', 'gstRate']);
    expect(problem(8)).toEqual(['branch']);
    expect(problem(9)).toEqual(['sku']);
    expect(problem(10)).toEqual(['sku']);
    expect(problem(12)).toEqual(['branch']);
    expect(problem(13)).toEqual(['hsnCode']);
    expect(errors.find((e) => e.row === 6).message).toContain('whole number');
    expect(partsToCreate).toBeGreaterThan(0);
  });

  it('refuses to save a file that has errors', async () => {
    const bad = row(5, { name: 'Bad', sku: 'BAD-1', unit: 'DOZEN' });
    const res = await send(admin, [idler, bad], false);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IMPORT_INVALID');
    expect(res.body.error.details).toEqual([expect.objectContaining({ row: 5, field: 'unit' })]);
    expect(await stockOf('ITR-IDL-200', 1)).toBeUndefined();
  });

  it('creates the parts with opening stock in each branch', async () => {
    const res = await send(admin, [idler, idlerInVijayawada, coolant], false);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ imported: true, partsToCreate: 2 });

    expect(await stockOf('ITR-IDL-200', 1)).toBe(6);
    expect(await stockOf('ITR-IDL-200', 2)).toBe(4);
    expect(await stockOf('GEN-CL-001', 1)).toBe(12.5);
    expect(await stockOf('GEN-CL-001', 2)).toBe(0);

    const part = (await admin.get('/products?search=ITR-IDL-200')).body.data[0];
    expect(part).toMatchObject({
      name: 'PC200 Idler 6 Hole',
      sku: 'ITR-IDL-200',
      partNumber: '20Y-30-00030',
      categoryName: 'Undercarriage',
      brandName: 'ITR',
      machineModel: 'PC200',
      unitCode: 'PCS',
      sellingPrice: 24000,
      mrp: 26000,
      minStockLevel: 2,
    });
    const detail = (await admin.get(`/products/${part.id}`)).body.data;
    expect(detail).toMatchObject({ hsnCode: '84314990', purchasePrice: 18500 });

    // Opening stock went through the ledger.
    const ledger = await admin.get(`/inventory/ledger?productId=${part.id}&types=OPENING`);
    expect(ledger.body.data).toEqual([
      expect.objectContaining({
        quantity: 6,
        newBalance: 6,
        reason: 'Opening stock (Excel import)',
      }),
    ]);
    expect((await db('categories').where({ name: 'Coolants' })).length).toBe(1);
  });

  it('skips parts that already exist instead of changing them', async () => {
    const existing = row(2, { name: 'Renamed', sku: 'JCB-HF-001', unit: 'PCS', openingStock: 99 });
    const fresh = row(3, { name: 'Fan Belt', sku: 'GEN-FB-001', unit: 'PCS' });
    const check = (await send(admin, [existing, idler, fresh], true)).body.data;
    expect(check.partsToCreate).toBe(1);
    expect(check.skipped.map((s) => s.sku)).toEqual(['JCB-HF-001', 'ITR-IDL-200']);

    expect((await send(admin, [existing, fresh], false)).body.data.imported).toBe(true);
    expect(await stockOf('JCB-HF-001', 1)).toBe(42);
    expect(await stockOf('GEN-FB-001', 1)).toBe(0);
    // Nothing new left in the file.
    expect((await send(admin, [existing, fresh], false)).status).toBe(400);
  });
});
