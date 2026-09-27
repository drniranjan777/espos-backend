import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, SALESMAN, WAREHOUSE, as } from '../helpers/api.js';
import { db, resetDatabase } from '../helpers/db.js';

let admin;
let warehouse;
let salesman;
let productId;

async function stockOf(id) {
  return (await admin.get(`/products/${id}`)).body.data.stockQuantity;
}

async function newProduct(overrides = {}) {
  const res = await admin.post('/products', {
    name: 'Test Part',
    sku: `T-${Math.random().toString(36).slice(2, 10)}`,
    unitId: 1, // PCS
    openingStock: 20,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  await resetDatabase();
  [admin, warehouse, salesman] = await Promise.all([as(ADMIN), as(WAREHOUSE), as(SALESMAN)]);
});
afterAll(() => db.destroy());

beforeEach(async () => {
  productId = (await newProduct()).id;
});

describe('opening stock', () => {
  it('books opening stock as an OPENING ledger entry', async () => {
    const ledger = (await admin.get(`/inventory/ledger?productId=${productId}`)).body.data;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      type: 'OPENING',
      quantity: 20,
      previousBalance: 0,
      newBalance: 20,
    });
  });

  it('creates a product with zero stock without a ledger entry', async () => {
    const product = await newProduct({ openingStock: 0 });
    expect(product.stockQuantity).toBe(0);
    const ledger = (await admin.get(`/inventory/ledger?productId=${product.id}`)).body.data;
    expect(ledger).toHaveLength(0);
  });
});

describe('stock IN', () => {
  it('increases stock and records previous/new balance (50 + 20 = 70 style)', async () => {
    const res = await warehouse.post('/inventory/stock-in', {
      productId,
      quantity: 50,
      purchasePrice: 99.5,
      supplier: 'ABC Traders',
      reference: 'PO-1',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'IN',
      quantity: 50,
      previousBalance: 20,
      newBalance: 70,
      partyName: 'ABC Traders',
      referenceNo: 'PO-1',
      userName: 'Warehouse Staff',
    });
    expect(await stockOf(productId)).toBe(70);
  });

  it('rejects zero, negative and non-numeric quantities', async () => {
    for (const quantity of [0, -5, 'abc']) {
      const res = await warehouse.post('/inventory/stock-in', { productId, quantity });
      expect(res.status).toBe(422);
    }
    expect(await stockOf(productId)).toBe(20);
  });

  it('rejects fractional quantities for whole-number units', async () => {
    const res = await warehouse.post('/inventory/stock-in', { productId, quantity: 1.5 });
    expect(res.status).toBe(400);
  });

  it('allows fractional quantities for decimal units', async () => {
    const litre = (await admin.get('/units?search=LTR')).body.data[0];
    const oil = await newProduct({ unitId: litre.id, openingStock: 10.5 });
    const res = await warehouse.post('/inventory/stock-in', { productId: oil.id, quantity: 2.25 });
    expect(res.status).toBe(201);
    expect(res.body.data.newBalance).toBe(12.75);
  });

  it('rejects future dates', async () => {
    const res = await warehouse.post('/inventory/stock-in', {
      productId,
      quantity: 1,
      date: '2999-01-01',
    });
    expect(res.status).toBe(422);
  });

  it('returns 404 for an unknown product', async () => {
    const res = await warehouse.post('/inventory/stock-in', { productId: 999999, quantity: 1 });
    expect(res.status).toBe(404);
  });
});

describe('stock OUT', () => {
  it('decreases stock and links the customer', async () => {
    const res = await salesman.post('/inventory/stock-out', {
      productId,
      quantity: 5,
      customerId: 1,
      reason: 'Counter sale',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'OUT',
      quantity: -5,
      previousBalance: 20,
      newBalance: 15,
    });
    expect(res.body.data.customerName).toBeTruthy();
    expect(await stockOf(productId)).toBe(15);
  });

  it('prevents negative stock with a clear error', async () => {
    const res = await warehouse.post('/inventory/stock-out', { productId, quantity: 21 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.message).toMatch(/Available: 20 PCS/);
    expect(res.body.error.details).toMatchObject({ available: 20, requested: 21 });
    expect(await stockOf(productId)).toBe(20);
  });

  it('allows issuing exactly the available quantity', async () => {
    const res = await warehouse.post('/inventory/stock-out', { productId, quantity: 20 });
    expect(res.status).toBe(201);
    expect(await stockOf(productId)).toBe(0);
  });

  it('never oversells under concurrent requests', async () => {
    // 10 parallel requests for 3 units each against 20 in stock: at most 6 can succeed.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        warehouse.post('/inventory/stock-out', { productId, quantity: 3 }),
      ),
    );
    const succeeded = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 409).length;
    expect(succeeded).toBe(6);
    expect(rejected).toBe(4);
    expect(await stockOf(productId)).toBe(2);

    const ledger = (await admin.get(`/inventory/ledger?productId=${productId}&limit=100`)).body
      .data;
    // Every ledger row chains correctly from the previous one.
    const chronological = [...ledger].reverse();
    for (let i = 1; i < chronological.length; i += 1) {
      expect(chronological[i].previousBalance).toBe(chronological[i - 1].newBalance);
    }
  });

  it('rejects an inactive customer', async () => {
    await db('customers').where({ id: 3 }).update({ is_active: false });
    const res = await warehouse.post('/inventory/stock-out', {
      productId,
      quantity: 1,
      customerId: 3,
    });
    expect(res.status).toBe(400);
    await db('customers').where({ id: 3 }).update({ is_active: true });
  });

  it('rejects stock movements on inactive products', async () => {
    await admin.patch(`/products/${productId}`, { isActive: false });
    const res = await warehouse.post('/inventory/stock-out', { productId, quantity: 1 });
    expect(res.status).toBe(400);
  });
});

describe('stock adjustment', () => {
  async function codeId(code) {
    return (await admin.get(`/adjustment-codes?search=${code}`)).body.data.find(
      (c) => c.code === code,
    ).id;
  }

  it('sets stock to a physical count and books the difference', async () => {
    const res = await admin.post('/inventory/adjustments', {
      productId,
      adjustmentCodeId: await codeId('PHYSICAL_COUNT'),
      mode: 'SET',
      quantity: 17,
      reason: 'Monthly count',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'ADJUSTMENT_OUT', quantity: -3, newBalance: 17 });
    expect(res.body.data.adjustmentCodeName).toBe('Physical Count');
    expect(await stockOf(productId)).toBe(17);
  });

  it('supports a physical count of zero', async () => {
    const res = await admin.post('/inventory/adjustments', {
      productId,
      adjustmentCodeId: await codeId('PHYSICAL_COUNT'),
      mode: 'SET',
      quantity: 0,
      reason: 'All missing',
    });
    expect(res.status).toBe(201);
    expect(await stockOf(productId)).toBe(0);
  });

  it('rejects a count that matches current stock', async () => {
    const res = await admin.post('/inventory/adjustments', {
      productId,
      adjustmentCodeId: await codeId('PHYSICAL_COUNT'),
      mode: 'SET',
      quantity: 20,
      reason: 'Count',
    });
    expect(res.status).toBe(400);
  });

  it('enforces the direction of the reason code', async () => {
    const res = await admin.post('/inventory/adjustments', {
      productId,
      adjustmentCodeId: await codeId('DAMAGED'),
      mode: 'IN',
      quantity: 1,
      reason: 'wrong way',
    });
    expect(res.status).toBe(400);
  });

  it('requires a reason', async () => {
    const res = await admin.post('/inventory/adjustments', {
      productId,
      adjustmentCodeId: await codeId('DAMAGED'),
      mode: 'OUT',
      quantity: 1,
    });
    expect(res.status).toBe(422);
  });

  it('cannot adjust below zero', async () => {
    const res = await admin.post('/inventory/adjustments', {
      productId,
      adjustmentCodeId: await codeId('LOST'),
      mode: 'OUT',
      quantity: 25,
      reason: 'Lost',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });
});

describe('ledger integrity', () => {
  it('cannot be modified or deleted at the database level', async () => {
    const row = await db('inventory_transactions').where({ product_id: productId }).first('id');
    await expect(
      db('inventory_transactions').where({ id: row.id }).update({ quantity: 999 }),
    ).rejects.toThrow(/append-only/);
    await expect(db('inventory_transactions').where({ id: row.id }).del()).rejects.toThrow(
      /append-only/,
    );
  });

  it('writes an audit entry for every movement', async () => {
    await warehouse.post('/inventory/stock-in', { productId, quantity: 1 });
    const logs = await db('audit_logs').where({ module: 'inventory', action: 'STOCK_IN' });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.at(-1).ip).toBeTruthy();
  });

  it('filters the ledger by type and date', async () => {
    await warehouse.post('/inventory/stock-in', { productId, quantity: 2 });
    await warehouse.post('/inventory/stock-out', { productId, quantity: 1 });
    const res = await admin.get(`/inventory/ledger?productId=${productId}&types=OUT`);
    expect(res.body.data.every((t) => t.type === 'OUT')).toBe(true);
    expect(res.body.meta.total).toBe(1);
  });
});

describe('permissions', () => {
  it('warehouse users cannot adjust stock or create products', async () => {
    const adjust = await warehouse.post('/inventory/adjustments', {
      productId,
      adjustmentCodeId: 1,
      mode: 'IN',
      quantity: 1,
      reason: 'x',
    });
    expect(adjust.status).toBe(403);
    expect((await warehouse.post('/products', { name: 'x', sku: 'X1', unitId: 1 })).status).toBe(
      403,
    );
  });

  it('salesmen cannot record stock IN', async () => {
    const res = await salesman.post('/inventory/stock-in', { productId, quantity: 1 });
    expect(res.status).toBe(403);
  });

  it('non-admins cannot manage users, roles or GST rates', async () => {
    expect((await warehouse.get('/users')).status).toBe(403);
    expect((await salesman.post('/roles', { name: 'Hacker', permissions: [] })).status).toBe(403);
    expect((await salesman.post('/gst-rates', { name: 'GST 3%', rate: 3 })).status).toBe(403);
  });

  it('permissions are data-driven: granting a permission takes effect immediately', async () => {
    const roles = (await admin.get('/roles')).body.data;
    const role = roles.find((r) => r.name === 'Salesman');
    await admin.put(`/roles/${role.id}`, {
      name: role.name,
      description: role.description,
      permissions: [...role.permissions, 'inventory.in'],
    });
    const res = await salesman.post('/inventory/stock-in', { productId, quantity: 1 });
    expect(res.status).toBe(201);
    await admin.put(`/roles/${role.id}`, {
      name: role.name,
      description: role.description,
      permissions: role.permissions,
    });
  });
});
