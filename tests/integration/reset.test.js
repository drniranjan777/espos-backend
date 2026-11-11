import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, SALESMAN, WAREHOUSE, as } from '../helpers/api.js';
import { db, resetDatabase } from '../helpers/db.js';

let admin;
let warehouse;
let salesman;

const count = async (table) => Number((await db(table).count({ n: '*' }).first()).n);

const body = (extra = {}) => ({
  scopes: ['stock_history', 'invoices'],
  phrase: 'RESET',
  password: ADMIN.password,
  skipBackup: true,
  ...extra,
});

beforeAll(async () => {
  await resetDatabase();
  [admin, warehouse, salesman] = await Promise.all([as(ADMIN), as(WAREHOUSE), as(SALESMAN)]);

  // Some business data to reset: a Stock IN, a Stock OUT and a finalized sales invoice.
  const stockIn = await admin.post('/stock-movements', {
    type: 'IN',
    noBill: true,
    items: [{ productId: 1, quantity: 5 }],
  });
  expect(stockIn.status).toBe(201);
  const stockOut = await admin.post('/stock-movements', {
    type: 'OUT',
    noBill: true,
    items: [{ productId: 1, quantity: 2 }],
  });
  expect(stockOut.status).toBe(201);
  const invoice = await salesman.post('/invoices', {
    customerId: 1,
    items: [{ productId: 1, quantity: 1 }],
  });
  expect((await salesman.post(`/invoices/${invoice.body.data.id}/finalize`, {})).status).toBe(200);
});
afterAll(() => db.destroy());

describe('Reset Everything: access', () => {
  it('is closed to everyone but Admin', async () => {
    for (const client of [warehouse, salesman]) {
      expect((await client.get('/admin/reset')).status).toBe(403);
      expect((await client.get('/admin/reset/preview?scopes=invoices')).status).toBe(403);
      expect((await client.get('/admin/reset/backup?scopes=invoices')).status).toBe(403);
      expect((await client.post('/admin/reset', body())).status).toBe(403);
    }
    expect((await admin.get('/admin/reset')).status).toBe(200);
  });

  it('lists the groups and what is always kept', async () => {
    const res = (await admin.get('/admin/reset')).body.data;
    expect(res.scopes.map((s) => s.id)).toEqual(['stock_history', 'invoices', 'products', 'customers']);
    expect(res.kept.join(' ')).toMatch(/Users/);
    expect(res.phrase).toBe('RESET');
  });
});

describe('Reset Everything: safety checks', () => {
  it('previews exact row counts and changes nothing', async () => {
    const before = await count('inventory_transactions');
    const res = await admin.get('/admin/reset/preview?scopes=stock_history,invoices');
    expect(res.status).toBe(200);
    const ledger = res.body.data.scopes
      .find((s) => s.id === 'stock_history')
      .tables.find((t) => t.table === 'inventory_transactions');
    expect(ledger.rows).toBe(before);
    expect(before).toBeGreaterThan(0);
    expect(res.body.data.totalRows).toBeGreaterThan(0);
    expect(await count('inventory_transactions')).toBe(before);
  });

  it('refuses unknown or empty selections and groups missing what they depend on', async () => {
    expect((await admin.get('/admin/reset/preview')).status).toBe(400);
    expect((await admin.get('/admin/reset/preview?scopes=everything')).status).toBe(400);
    const lonely = await admin.get('/admin/reset/preview?scopes=products');
    expect(lonely.status).toBe(400);
    expect(lonely.body.error.message).toMatch(/together with/);
    expect((await admin.post('/admin/reset', body({ scopes: ['customers'] }))).status).toBe(400);
  });

  it('needs the typed word, the right password, and a backup or an explicit skip', async () => {
    const products = await count('products');
    const ledger = await count('inventory_transactions');
    expect((await admin.post('/admin/reset', body({ phrase: 'reset it' }))).status).toBe(400);
    expect((await admin.post('/admin/reset', body({ password: 'Wrong@1234' }))).status).toBe(400);
    const noBackup = await admin.post('/admin/reset', body({ skipBackup: false }));
    expect(noBackup.status).toBe(400);
    expect(noBackup.body.error.message).toMatch(/backup/i);
    expect((await admin.post('/admin/reset', body({ backupId: crypto.randomUUID(), skipBackup: false }))).status).toBe(400);
    expect(await count('products')).toBe(products);
    expect(await count('inventory_transactions')).toBe(ledger);
  });

  it('rejects a backup made for different data', async () => {
    const backup = await admin.get('/admin/reset/backup?scopes=invoices');
    expect(backup.status).toBe(200);
    const res = await admin.post(
      '/admin/reset',
      body({ backupId: backup.headers['x-backup-id'], skipBackup: false }),
    );
    expect(res.status).toBe(400);
  });
});

describe('Reset Everything: the reset itself', () => {
  it('downloads a backup of the rows, then clears only the chosen groups', async () => {
    const entries = await count('stock_movements');
    const invoices = await count('invoices');
    const ledger = await count('inventory_transactions');
    expect(entries).toBeGreaterThan(0);
    expect(invoices).toBeGreaterThan(0);

    const backup = await admin.get('/admin/reset/backup?scopes=invoices,stock_history');
    expect(backup.status).toBe(200);
    expect(backup.headers['content-disposition']).toMatch(/attachment; filename="jcb-backup-/);
    expect(backup.body.tables.inventory_transactions).toHaveLength(ledger);
    expect(backup.body.tables.invoices).toHaveLength(invoices);

    const users = await count('users');
    const roles = await count('roles');
    const products = await count('products');
    const customers = await count('customers');
    const categories = await count('categories');
    const company = await db('company_settings').where({ id: 1 }).first();

    const res = await admin.post(
      '/admin/reset',
      body({ backupId: backup.headers['x-backup-id'], skipBackup: false }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ backedUp: true, scopes: ['stock_history', 'invoices'] });
    expect(res.body.data.removed.stock_movements).toBe(entries);

    // Cleared
    for (const table of ['stock_movements', 'inventory_transactions', 'purchase_invoices', 'invoices', 'invoice_items']) {
      expect(await count(table)).toBe(0);
    }
    expect(Number((await db('inventory').sum({ q: 'quantity' }).first()).q)).toBe(0);
    expect(await db('invoice_sequences').whereIn('prefix', ['SI', 'SO', 'PI', 'ST', 'INV'])).toEqual([]);

    // Kept
    expect(await count('users')).toBe(users);
    expect(await count('roles')).toBe(roles);
    expect(await count('products')).toBe(products);
    expect(await count('customers')).toBe(customers);
    expect(await count('categories')).toBe(categories);
    expect(await db('company_settings').where({ id: 1 }).first()).toEqual(company);

    // Logged: the backup and the reset, with who and what.
    const logs = await db('audit_logs').where({ module: 'system' }).orderBy('id');
    expect(logs.map((l) => l.action)).toContain('BACKUP');
    const reset = logs.find((l) => l.action === 'RESET');
    expect(reset.user_id).toBeTruthy();
    expect(reset.new_value.scopes).toEqual(['stock_history', 'invoices']);
    expect(reset.new_value.backup).toBe(true);
  });

  it('leaves the app working: signing in, and new entries numbered from 1', async () => {
    const again = await as(ADMIN);
    const res = await again.post('/stock-movements', {
      type: 'IN',
      noBill: true,
      items: [{ productId: 1, quantity: 3 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.movementNo).toMatch(/\/0001$/);
    expect((await again.get('/products/1')).body.data.stockQuantity).toBe(3);
  });

  it('clears products and customers only together with what points to them', async () => {
    const res = await admin.post(
      '/admin/reset',
      body({ scopes: ['stock_history', 'invoices', 'products', 'customers'] }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.backedUp).toBe(false);
    expect(await count('products')).toBe(0);
    expect(await count('inventory')).toBe(0);
    expect(await count('customers')).toBe(0);
    // Masters, people and branches stay.
    expect(await count('categories')).toBeGreaterThan(0);
    expect(await count('units')).toBeGreaterThan(0);
    expect(await count('users')).toBeGreaterThan(0);
    expect(await count('warehouses')).toBeGreaterThan(0);
    const last = await db('audit_logs').where({ action: 'RESET' }).orderBy('id', 'desc').first();
    expect(last.new_value.backup).toBe(false);
  });
});
