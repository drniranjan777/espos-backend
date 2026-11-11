import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayIso } from '../../src/utils/date.js';
import { ADMIN, WAREHOUSE, as } from '../helpers/api.js';
import { db, resetDatabase } from '../helpers/db.js';

// Demo seed: product 1 = Hydraulic Filter (JCB-HF-001), purchase price 620.
let admin;
let warehouse;
let auditor; // not an Admin, but allowed to edit products and see reports

const daysAgo = (n) => {
  const d = new Date(`${todayIso()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const daysAhead = (n) => daysAgo(-n);

const move = (client, body) =>
  client.post('/stock-movements', { noBill: true, ...body });

beforeAll(async () => {
  await resetDatabase();
  [admin, warehouse] = await Promise.all([as(ADMIN), as(WAREHOUSE)]);

  const role = await admin.post('/roles', {
    name: 'Auditor',
    description: 'Reports and product edits',
    permissions: [
      'dashboard.view',
      'reports.view',
      'products.view',
      'products.create',
      'products.update',
      'inventory.view',
    ],
  });
  expect(role.status).toBe(201);
  const user = await admin.post('/users', {
    name: 'Audit User',
    username: 'auditor',
    password: 'Staff@1234',
    roleId: role.body.data.id,
  });
  expect(user.status).toBe(201);
  // Legacy data: a role that was once given purchase permissions directly in the database.
  await db.raw(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT ?, id FROM permissions WHERE code IN ('purchase.view', 'purchase.price')`,
    [role.body.data.id],
  );
  auditor = await as({ login: 'auditor', password: 'Staff@1234' });
});
afterAll(() => db.destroy());

describe('purchase price is Admin only', () => {
  it('shows it to Admin and to nobody else, on product reads', async () => {
    expect((await admin.get('/products/1')).body.data.purchasePrice).toBe(620);
    for (const client of [warehouse, auditor]) {
      const res = await client.get('/products/1');
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('purchasePrice');
      expect(JSON.stringify(res.body)).not.toContain('620');
    }
  });

  it('holds even when a role was given purchase permissions in the database', async () => {
    const me = (await auditor.get('/auth/me')).body.data;
    expect(me.permissions).not.toContain('purchase.price');
    expect(me.permissions).not.toContain('purchase.view');
    expect((await auditor.get('/purchase-invoices')).status).toBe(403);
    expect((await admin.get('/purchase-invoices')).status).toBe(200);
  });

  it('cannot be granted to another role', async () => {
    const res = await admin.post('/roles', {
      name: 'Cost Viewer',
      permissions: ['purchase.view', 'products.view'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Only the Admin role/);
  });

  it('cannot be set by non-admins, and Admin can set it', async () => {
    const denied = await auditor.patch('/products/1', { purchasePrice: 1 });
    expect(denied.status).toBe(403);
    // Editing something else is fine and returns no price.
    const ok = await auditor.patch('/products/1', { minStockLevel: 6 });
    expect(ok.status).toBe(200);
    expect(ok.body.data).not.toHaveProperty('purchasePrice');
    // Creating a product as a non-admin never stores a price.
    const created = await auditor.post('/products', {
      name: 'No cost',
      sku: 'NC-1',
      unitId: 1,
      purchasePrice: 0,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).not.toHaveProperty('purchasePrice');

    const set = await admin.patch('/products/1', { purchasePrice: 640 });
    expect(set.status).toBe(200);
    expect(set.body.data.purchasePrice).toBe(640);
    expect((await admin.patch('/products/1', { purchasePrice: 620 })).status).toBe(200);
  });

  it('is left out of the ledger, Stock IN entries, reports and the dashboard', async () => {
    const entry = await move(admin, { type: 'IN', items: [{ productId: 1, quantity: 1, purchasePrice: 620 }] });
    expect(entry.status).toBe(201);
    expect(entry.body.data.items[0].purchasePrice).toBe(620);

    const detail = await warehouse.get(`/stock-movements/${entry.body.data.id}`);
    expect(detail.body.data.items[0]).not.toHaveProperty('purchasePrice');
    expect(detail.body.data.items[0]).not.toHaveProperty('previousPurchasePrice');

    const ledgerAdmin = await admin.get('/inventory/ledger?limit=50&types=IN');
    expect(ledgerAdmin.body.data.some((r) => r.unitPrice != null)).toBe(true);
    const ledger = await warehouse.get('/inventory/ledger?limit=50&types=IN');
    expect(ledger.body.data.length).toBeGreaterThan(0);
    expect(ledger.body.data.every((r) => !('unitPrice' in r))).toBe(true);

    const valuation = await auditor.get('/reports/stock-valuation');
    expect(valuation.status).toBe(200);
    expect(valuation.body.data.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(valuation.body)).not.toMatch(/purchase/i);
    expect(valuation.body.data.totals).toHaveProperty('sellingValue');
    const full = await admin.get('/reports/stock-valuation');
    expect(full.body.data.totals).toHaveProperty('purchaseValue');
    expect(full.body.data.rows[0]).toHaveProperty('purchasePrice');

    expect((await auditor.get('/dashboard/summary')).body.data).not.toHaveProperty('stockValue');
    expect((await admin.get('/dashboard/summary')).body.data).toHaveProperty('stockValue');
  });

  it('is ignored in a product import by non-admins', async () => {
    const rows = [
      { rowNumber: 2, name: 'Imported', sku: 'IMP-COST', unit: 'PCS', purchasePrice: 555, openingStock: 1 },
    ];
    const res = await auditor.post('/products/import', { rows, dryRun: false });
    expect(res.status).toBe(200);
    expect((await db('products').where({ sku: 'IMP-COST' }).first()).purchase_price).toBe(0);
  });
});

describe('duplicate SKU / part code', () => {
  let first;
  let second;

  it('lets several products share one SKU, each with its own id', async () => {
    first = (await admin.post('/products', { name: 'Seal Kit Small', sku: 'SEAL-1', unitId: 1 })).body.data;
    const dup = await admin.post('/products', { name: 'Seal Kit Large', sku: 'seal-1', unitId: 1 });
    expect(dup.status).toBe(201);
    second = dup.body.data;
    expect(second.id).not.toBe(first.id);
    expect(second.sku).toBe('SEAL-1');
  });

  it('finds every product with that SKU, with details that tell them apart', async () => {
    const res = await warehouse.get('/products/search?q=SEAL-1');
    const names = res.body.data.map((p) => p.name).sort();
    expect(names).toEqual(['Seal Kit Large', 'Seal Kit Small']);
    expect(res.body.data[0]).toHaveProperty('categoryName');
    expect(res.body.data[0]).toHaveProperty('brandName');
    const list = await warehouse.get('/products?search=SEAL-1');
    expect(list.body.meta.total).toBe(2);
  });

  it('books stock to the product chosen by id, not by SKU', async () => {
    const res = await move(warehouse, { type: 'IN', items: [{ productId: second.id, quantity: 7 }] });
    expect(res.status).toBe(201);
    expect((await admin.get(`/products/${second.id}`)).body.data.stockQuantity).toBe(7);
    expect((await admin.get(`/products/${first.id}`)).body.data.stockQuantity).toBe(0);
  });

  it('imports same-SKU rows as separate parts when their names differ', async () => {
    const rows = [
      { rowNumber: 2, name: 'Pin A', sku: 'PIN-9', unit: 'PCS', openingStock: 2 },
      { rowNumber: 3, name: 'Pin B', sku: 'PIN-9', unit: 'PCS', openingStock: 3 },
      { rowNumber: 4, sku: 'PIN-9', unit: 'PCS', branch: 'Vijayawada', openingStock: 4 },
    ];
    const check = await admin.post('/products/import', { rows, dryRun: true });
    expect(check.body.data.partsToCreate).toBe(2);
    expect(check.body.data.errors).toEqual([]);
    expect((await admin.post('/products/import', { rows, dryRun: false })).status).toBe(200);
    expect(await db('products').where({ sku: 'PIN-9' }).count({ n: '*' }).first()).toEqual({ n: 2 });
    // Importing the same file again leaves them alone.
    const again = await admin.post('/products/import', { rows: rows.slice(0, 2), dryRun: true });
    expect(again.body.data.partsToCreate).toBe(0);
    expect(again.body.data.skipped).toHaveLength(2);
  });
});

describe('Stock IN / OUT on a chosen date', () => {
  let part;

  beforeAll(async () => {
    part = (await admin.post('/products', { name: 'Dated Part', sku: 'DATE-1', unitId: 1 })).body.data;
  });

  const stock = async () => (await admin.get(`/products/${part.id}`)).body.data.stockQuantity;

  it('saves the chosen date and keeps the real creation time', async () => {
    const date = daysAgo(10);
    const res = await move(admin, { type: 'IN', date, items: [{ productId: part.id, quantity: 5 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.movementDate).toBe(date);
    expect(res.body.data.createdAt.slice(0, 10)).not.toBe(date);
    expect(Date.now() - new Date(res.body.data.createdAt).getTime()).toBeLessThan(60_000);

    const ledger = await admin.get(`/inventory/ledger?productId=${part.id}`);
    expect(ledger.body.data[0]).toMatchObject({ type: 'IN', txnDate: date });
    expect(await stock()).toBe(5);
  });

  it('rejects a future date', async () => {
    const res = await move(admin, { type: 'IN', date: daysAhead(1), items: [{ productId: part.id, quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/future/i);
    expect(await stock()).toBe(5);
  });

  it('filters the history by date', async () => {
    const day = daysAgo(10);
    const hit = await admin.get(`/stock-movements?type=IN&from=${day}&to=${day}`);
    expect(hit.body.data.map((m) => m.movementDate)).toEqual([day]);
    const miss = await admin.get(`/stock-movements?from=${daysAgo(9)}&to=${daysAgo(1)}`);
    expect(miss.body.data.filter((m) => m.movementDate === day)).toEqual([]);
  });

  it('refuses a backdated OUT that would make the balance negative on any day', async () => {
    // 5 arrived 10 days ago. Before that there was nothing.
    const early = await move(admin, { type: 'OUT', date: daysAgo(12), items: [{ productId: part.id, quantity: 1 }] });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INSUFFICIENT_STOCK');

    // 2 go out 5 days ago, leaving 3 from then on.
    expect((await move(admin, { type: 'OUT', date: daysAgo(5), items: [{ productId: part.id, quantity: 2 }] })).status).toBe(201);
    // 4 on day 8 would be fine that day (5 on hand) but leave -1 after day 5.
    const clash = await move(admin, { type: 'OUT', date: daysAgo(8), items: [{ productId: part.id, quantity: 4 }] });
    expect(clash.status).toBe(409);
    expect(await stock()).toBe(3);
    // 3 is fine on every day.
    expect((await move(admin, { type: 'OUT', date: daysAgo(8), items: [{ productId: part.id, quantity: 3 }] })).status).toBe(201);
    expect(await stock()).toBe(0);
  });

  it('keeps date-wise reports and balances exact after backdated entries', async () => {
    const report = await admin.get(`/reports/movement?from=${daysAgo(30)}&to=${daysAgo(6)}&search=DATE-1`);
    expect(report.status).toBe(200);
    expect(report.body.data[0]).toMatchObject({
      openingBalance: 0,
      stockIn: 5,
      stockOut: 3,
      closingBalance: 2,
    });
    const rest = await admin.get(`/reports/movement?from=${daysAgo(5)}&to=${todayIso()}&search=DATE-1`);
    expect(rest.body.data[0]).toMatchObject({ openingBalance: 2, stockOut: 2, closingBalance: 0 });

    // The ledger chain still adds up in the order entries were booked.
    const rows = await db('inventory_transactions').where({ product_id: part.id }).orderBy('id');
    let balance = 0;
    for (const r of rows) {
      expect(Number(r.previous_balance)).toBe(balance);
      balance += Number(r.quantity);
      expect(Number(r.new_balance)).toBe(balance);
    }
    expect(balance).toBe(0);
  });
});
