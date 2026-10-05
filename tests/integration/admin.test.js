import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, SALESMAN, WAREHOUSE, app, as, request } from '../helpers/api.js';
import { db, resetDatabase } from '../helpers/db.js';

let admin;
let salesman;
let warehouse;

beforeAll(async () => {
  await resetDatabase();
  [admin, salesman, warehouse] = await Promise.all([as(ADMIN), as(SALESMAN), as(WAREHOUSE)]);
});
afterAll(() => db.destroy());

describe('masters', () => {
  it('lists GST rates with CGST/SGST/IGST split from the database', async () => {
    const res = await salesman.get('/gst-rates');
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.rate)).toEqual([0, 5, 12, 18, 28]);
    expect(res.body.data.find((r) => r.rate === 18)).toMatchObject({
      cgstRate: 9,
      sgstRate: 9,
      igstRate: 18,
    });
  });

  it('creates GST rates but never changes an existing rate value', async () => {
    const created = await admin.post('/gst-rates', { name: 'GST 3%', rate: 3 });
    expect(created.status).toBe(201);
    const dup = await admin.post('/gst-rates', { name: 'Dup', rate: 3 });
    expect(dup.status).toBe(409);
    const patch = await admin.patch(`/gst-rates/${created.body.data.id}`, {
      rate: 4,
      name: 'Renamed',
    });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toMatchObject({ rate: 3, name: 'Renamed' });
  });

  it('rejects duplicate brand names case-insensitively', async () => {
    const res = await admin.post('/brands', { name: 'jcb' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/brand/i);
  });

  it('supports two-level categories only', async () => {
    const parent = (await admin.get('/categories?search=Filters')).body.data[0];
    const child = await admin.post('/categories', { name: 'Air Filters', parentId: parent.id });
    expect(child.status).toBe(201);
    expect(child.body.data.parentName).toBe('Filters');
    const grandchild = await admin.post('/categories', {
      name: 'Deep',
      parentId: child.body.data.id,
    });
    expect(grandchild.status).toBe(400);
  });

  it('refuses to delete a master that is in use', async () => {
    const brand = (await admin.get('/brands?search=JCB')).body.data[0];
    const res = await admin.delete(`/brands/${brand.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });

  it('PATCH leaves omitted fields unchanged', async () => {
    const unit = (await admin.get('/units?search=LTR')).body.data[0];
    const res = await admin.patch(`/units/${unit.id}`, { name: 'Litres' });
    expect(res.body.data).toMatchObject({
      name: 'Litres',
      code: 'LTR',
      allowDecimal: true,
      isActive: true,
    });
  });
});

describe('products', () => {
  it('searches by name, SKU, part number, brand, machine model and HSN', async () => {
    for (const q of ['hydraulic', 'jcb-hf-001', '32/925346', 'komatsu', 'PC200', '84213100']) {
      const res = await warehouse.get(`/products/search?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    }
  });

  it('matches every word across fields (typed or spoken searches)', async () => {
    const names = async (q) =>
      (await warehouse.get(`/products/search?q=${encodeURIComponent(q)}`)).body.data.map(
        (p) => p.sku,
      );
    // Hydraulic Filter (3DX) and Hydraulic Pump Seal Kit (3DX Super).
    expect((await names('hydraulic 3dx')).sort()).toEqual(['JCB-HF-001', 'JCB-SK-006']);
    expect(await names('JCB HF 001')).toEqual(['JCB-HF-001']);
    // No product is both: only "similar" fallback suggestions, never exact matches.
    const mixed = await warehouse.get('/products/search?q=filter%20komatsu');
    expect(mixed.body.data.every((p) => p.matchType === 'similar')).toBe(true);
  });

  it('matches part numbers regardless of separators (spoken codes)', async () => {
    const skus = async (q) =>
      (await warehouse.get(`/products/search?q=${encodeURIComponent(q)}`)).body.data.map(
        (p) => p.sku,
      );
    // Engine Oil Filter has part number 320/04133.
    expect((await skus('32004133'))[0]).toBe('JCB-OF-002');
    expect((await skus('320-04133'))[0]).toBe('JCB-OF-002');
    expect(await skus('320 04133')).toContain('JCB-OF-002');
  });

  it('falls back to closest matches for misheard words', async () => {
    const res = await warehouse.get(`/products/search?q=${encodeURIComponent('hydrolic filtar')}`);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((p) => p.matchType === 'similar')).toBe(true);
    expect(res.body.data[0].name).toMatch(/hydraulic/i);

    const exact = await warehouse.get('/products/search?q=hydraulic');
    expect(exact.body.data.every((p) => p.matchType === 'exact')).toBe(true);

    const nothing = await warehouse.get('/products/search?q=zzqx');
    expect(nothing.body.data).toEqual([]);
  });

  it('treats % and _ in searches as plain characters', async () => {
    const res = await warehouse.get('/products/search?q=%25');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('ranks an exact SKU match first', async () => {
    const res = await warehouse.get('/products/search?q=JCB-OF-002');
    expect(res.body.data[0].sku).toBe('JCB-OF-002');
    expect(res.body.data[0]).toHaveProperty('stockQuantity');
  });

  it('filters by stock status and paginates', async () => {
    const out = await admin.get('/products?stockStatus=out');
    expect(out.body.data.every((p) => p.stockQuantity <= 0)).toBe(true);
    const page = await admin.get('/products?limit=5&page=2');
    expect(page.body.meta).toMatchObject({ page: 2, limit: 5, total: 14, totalPages: 3 });
    expect(page.body.data).toHaveLength(5);
  });

  it('rejects unknown sort fields instead of passing them to SQL', async () => {
    const res = await admin.get('/products?sortBy=name;drop table products');
    expect(res.status).toBe(422);
  });

  it('enforces unique SKU and selling price <= MRP', async () => {
    const dup = await admin.post('/products', { name: 'X', sku: 'jcb-hf-001', unitId: 1 });
    expect(dup.status).toBe(409);
    const price = await admin.post('/products', {
      name: 'X',
      sku: 'NEW-1',
      unitId: 1,
      sellingPrice: 100,
      mrp: 90,
    });
    expect(price.status).toBe(422);
    const patch = await admin.patch('/products/1', { sellingPrice: 99999 });
    expect(patch.status).toBe(422);
  });

  it('only deletes products without history', async () => {
    expect((await admin.delete('/products/1')).status).toBe(409);
    const fresh = await admin.post('/products', { name: 'Unused', sku: 'UNUSED-1', unitId: 1 });
    expect((await admin.delete(`/products/${fresh.body.data.id}`)).status).toBe(200);
  });
});

describe('customers', () => {
  it('derives the state from the GSTIN', async () => {
    const res = await salesman.post('/customers', {
      name: 'Delhi Cranes',
      gstin: '07aabcd1234e1z5',
      mobile: '98100 12345',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      gstin: '07AABCD1234E1Z5',
      stateCode: '07',
      state: 'Delhi',
      mobile: '9810012345',
    });
  });

  it('rejects a state code that contradicts the GSTIN, and invalid formats', async () => {
    const mismatch = await salesman.post('/customers', {
      name: 'X',
      gstin: '27AAPFP1234C1Z6',
      stateCode: '29',
    });
    expect(mismatch.status).toBe(422);
    const bad = await salesman.post('/customers', {
      name: 'X',
      gstin: 'NOTAGSTIN',
      pincode: '12',
      email: 'x',
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.map((d) => d.field).sort()).toEqual([
      'email',
      'gstin',
      'pincode',
    ]);
  });

  it('PATCH does not clear omitted fields', async () => {
    const res = await salesman.patch('/customers/1', { city: 'Pimpri' });
    expect(res.body.data).toMatchObject({
      city: 'Pimpri',
      gstin: '27AAPFP1234C1Z5',
      mobile: '9876543210',
    });
  });

  it('warehouse users can pick and add customers but not edit or delete them', async () => {
    expect((await warehouse.get('/customers?search=patil')).status).toBe(200);
    const created = await warehouse.post('/customers', { name: 'Ravi Teja', mobile: '9876500011' });
    expect(created.status).toBe(201);
    expect(
      (await warehouse.patch(`/customers/${created.body.data.id}`, { city: 'X' })).status,
    ).toBe(403);
    expect((await warehouse.delete(`/customers/${created.body.data.id}`)).status).toBe(403);
  });
});

describe('company settings', () => {
  it('is readable by everyone and writable only with settings.manage', async () => {
    expect((await salesman.get('/settings/company')).body.data.companyName).toBe(
      'Shree Ganesh Machinery Spares',
    );
    expect((await salesman.put('/settings/company', { companyName: 'Hacked' })).status).toBe(403);
  });

  it('validates GSTIN / state / PAN consistency against saved values', async () => {
    const res = await admin.put('/settings/company', { stateCode: '29' });
    expect(res.status).toBe(422);
    const ok = await admin.put('/settings/company', { invoicePrefix: 'sgm', phone: '020-1234' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ invoicePrefix: 'SGM', gstin: '27ABCDE1234F1Z5' });
  });

  it('uploads and replaces the logo, rejecting non-images', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await request(app)
      .post('/api/v1/settings/company/logo')
      .set('Authorization', `Bearer ${admin.token}`)
      .attach('logo', png, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data.logoUrl).toMatch(/^\/uploads\/logo-[a-f0-9]+\.png$/);

    const text = await request(app)
      .post('/api/v1/settings/company/logo')
      .set('Authorization', `Bearer ${admin.token}`)
      .attach('logo', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(text.status).toBe(400);

    expect((await admin.delete('/settings/company/logo')).body.data.logoUrl).toBeNull();
  });
});

describe('users and roles', () => {
  it('creates users with validated input and never returns password hashes', async () => {
    const roles = (await admin.get('/roles')).body.data;
    const res = await admin.post('/users', {
      name: 'New Staff',
      username: 'New.Staff',
      password: 'Staff@1234',
      roleId: roles.find((r) => r.name === 'Warehouse User').id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.username).toBe('new.staff');
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const weak = await admin.post('/users', {
      name: 'W',
      username: 'weak',
      password: 'short',
      roleId: 1,
    });
    expect(weak.status).toBe(422);
    const dup = await admin.post('/users', {
      name: 'D',
      username: 'ADMIN',
      password: 'Staff@1234',
      roleId: 1,
    });
    expect(dup.status).toBe(409);
  });

  it('prevents locking out the last admin', async () => {
    const me = (await admin.get('/auth/me')).body.data;
    expect((await admin.patch(`/users/${me.id}`, { isActive: false })).status).toBe(400);
    expect((await admin.patch(`/users/${me.id}`, { roleId: 2 })).status).toBe(400);
  });

  it('protects the Admin role', async () => {
    const adminRole = (await admin.get('/roles')).body.data.find((r) => r.isSystem);
    expect((await admin.delete(`/roles/${adminRole.id}`)).status).toBe(400);
    const res = await admin.put(`/roles/${adminRole.id}`, { name: 'Admin', permissions: [] });
    expect(res.status).toBe(400);
  });

  it('creates custom roles and rejects unknown permissions', async () => {
    const res = await admin.post('/roles', {
      name: 'Auditor',
      permissions: ['audit.view', 'dashboard.view'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.permissions).toEqual(['audit.view', 'dashboard.view']);
    const bad = await admin.post('/roles', { name: 'Bad', permissions: ['everything.all'] });
    expect(bad.status).toBe(400);
    expect((await admin.delete(`/roles/${res.body.data.id}`)).status).toBe(200);
  });
});

describe('dashboard and reports', () => {
  it('shows today movement and hides sales from warehouse users', async () => {
    await warehouse.post('/inventory/stock-in', { productId: 1, quantity: 5 });
    await warehouse.post('/inventory/stock-out', { productId: 1, quantity: 2 });

    const adminView = (await admin.get('/dashboard/summary')).body.data;
    expect(adminView).toMatchObject({ totalProducts: 14 });
    expect(adminView.today.stockIn).toBeGreaterThanOrEqual(5);
    expect(adminView.today.stockOut).toBeGreaterThanOrEqual(2);
    expect(adminView.today).toHaveProperty('salesValue');
    expect(adminView).toHaveProperty('stockValue');
    expect(adminView.lowStock.some((p) => p.sku === 'ESC-WP-014')).toBe(true);

    const warehouseView = (await warehouse.get('/dashboard/summary')).body.data;
    expect(warehouseView.today).not.toHaveProperty('salesValue');
    expect(warehouseView).not.toHaveProperty('stockValue');
  });

  it('returns IN vs OUT series for each range', async () => {
    for (const [range, points] of [
      ['daily', 14],
      ['weekly', 12],
      ['monthly', 12],
    ]) {
      const res = await admin.get(`/dashboard/movement?range=${range}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(points);
    }
    const daily = (await admin.get('/dashboard/movement?range=daily')).body.data;
    expect(daily.at(-1).stockIn).toBeGreaterThan(0);
  });

  it('builds a movement report whose closing balance matches current stock', async () => {
    const today = (await admin.get('/dashboard/summary')).body.data.date;
    const res = await admin.get(`/reports/movement?from=${today}&to=${today}&search=JCB-HF-001`);
    expect(res.status).toBe(200);
    const row = res.body.data[0];
    const product = (await admin.get('/products/1')).body.data;
    expect(row.closingBalance).toBe(product.stockQuantity);

    const tooLong = await admin.get(`/reports/movement?from=2000-01-01&to=${today}`);
    expect(tooLong.status).toBe(400);
  });

  it('builds a stock valuation report and restricts reports', async () => {
    const res = await admin.get('/reports/stock-valuation');
    expect(res.body.data.totals.purchaseValue).toBeGreaterThan(0);
    expect((await salesman.get('/reports/stock-valuation')).status).toBe(403);
  });
});

describe('audit trail', () => {
  it('records who changed what, with old and new values', async () => {
    await admin.patch('/products/2', { minStockLevel: 25 });
    const res = await admin.get('/audit-logs?module=products&recordId=2&action=UPDATE');
    expect(res.status).toBe(200);
    const entry = res.body.data[0];
    expect(entry).toMatchObject({ userName: 'Administrator', module: 'products', recordId: '2' });
    expect(entry.oldValue.minStockLevel).toBe(15);
    expect(entry.newValue.minStockLevel).toBe(25);
  });

  it('never stores password hashes', async () => {
    const rows = await db('audit_logs').select('old_value', 'new_value');
    expect(JSON.stringify(rows)).not.toMatch(/password_?hash/i);
  });

  it('is restricted to audit.view', async () => {
    expect((await salesman.get('/audit-logs')).status).toBe(403);
  });
});
