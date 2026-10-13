import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, SALESMAN, WAREHOUSE, as } from '../helpers/api.js';
import { db, resetDatabase } from '../helpers/db.js';

// Demo seed: branch 1 = Hyderabad (default). Admin holds every permission; the warehouse
// user may record Stock IN but not change purchase prices or see billing invoices.
let admin;
let warehouse;
let part; // product 1 as it is before each scenario
let other; // product 2

const product = async (id) => (await admin.get(`/products/${id}`)).body.data;
const count = async (table) => Number((await db(table).count({ n: '*' }).first()).n);
const snapshot = async () => ({
  stock: (await product(1)).stockQuantity,
  price: (await product(1)).purchasePrice,
  entries: await count('stock_movements'),
  invoices: await count('purchase_invoices'),
  ledger: await count('inventory_transactions'),
});

const stockIn = (client, items, extra = {}) =>
  client.post('/stock-movements', { type: 'IN', invoiceNumber: 'SUP-1001', items, ...extra });

beforeAll(async () => {
  await resetDatabase();
  [admin, warehouse] = await Promise.all([as(ADMIN), as(WAREHOUSE)]);
  // Known starting prices and 18% GST on both parts.
  const gst18 = await db('gst_rates').where({ rate: 18 }).first('id');
  await db('products').whereIn('id', [1, 2]).update({ purchase_price: 100, gst_rate_id: gst18.id });
  await db('company_settings').where({ id: 1 }).update({ state_code: '36' });
  [part, other] = await Promise.all([product(1), product(2)]);
});
afterAll(() => db.destroy());

describe('Stock IN with purchase prices', () => {
  let entry;

  it('A: a higher price updates the product and creates the billing invoice', async () => {
    const res = await stockIn(admin, [{ productId: 1, quantity: 50, purchasePrice: 115 }]);
    expect(res.status).toBe(201);
    entry = res.body.data;

    const after = await product(1);
    expect(after.stockQuantity).toBe(part.stockQuantity + 50);
    expect(after.purchasePrice).toBe(115);
    expect(entry.items[0]).toMatchObject({ previousPurchasePrice: 100, purchasePrice: 115 });
    expect(entry.purchaseInvoiceNo).toMatch(/^PI\/\d{4}-\d{2}\/0001$/);

    const invoice = (await admin.get(`/purchase-invoices/${entry.purchaseInvoiceId}`)).body.data;
    expect(invoice).toMatchObject({
      invoiceNo: entry.purchaseInvoiceNo,
      movementId: entry.id,
      movementNo: entry.movementNo,
      supplierInvoiceNumber: 'SUP-1001',
      noBill: false,
      status: 'POSTED',
      supplyType: 'INTRA',
      subtotal: 5750,
      taxableAmount: 5750,
      cgstAmount: 517.5,
      sgstAmount: 517.5,
      igstAmount: 0,
      totalTax: 1035,
      grandTotal: 6785,
      paidAmount: 0,
      outstandingAmount: 6785,
      paymentStatus: 'UNPAID',
    });
    expect(invoice.items).toEqual([
      expect.objectContaining({
        productId: 1,
        quantity: 50,
        previousRate: 100,
        rate: 115,
        gstRate: 18,
        taxableValue: 5750,
        lineTotal: 6785,
      }),
    ]);

    // The price change is kept as history and the ledger row carries the price paid.
    expect(await db('product_price_history').where({ product_id: 1 })).toEqual([
      expect.objectContaining({ old_price: 100, new_price: 115, movement_id: entry.id }),
    ]);
    const ledger = await db('inventory_transactions')
      .where({ reference_type: 'MOVEMENT', reference_id: entry.id })
      .first('unit_price');
    expect(ledger.unit_price).toBe(115);
  });

  it('B: without a price the current price is kept and still invoiced', async () => {
    const before = await product(1);
    const res = await stockIn(admin, [{ productId: 1, quantity: 20 }]);
    expect(res.status).toBe(201);

    const after = await product(1);
    expect(after.stockQuantity).toBe(before.stockQuantity + 20);
    expect(after.purchasePrice).toBe(115);
    expect(res.body.data.items[0]).toMatchObject({
      previousPurchasePrice: 115,
      purchasePrice: 115,
    });
    const invoice = (await admin.get(`/purchase-invoices/${res.body.data.purchaseInvoiceId}`)).body
      .data;
    expect(invoice).toMatchObject({ subtotal: 2300, totalTax: 414, grandTotal: 2714 });
    expect(await count('product_price_history')).toBe(1);
  });

  it('prices each part separately and can lower a price', async () => {
    const res = await stockIn(admin, [
      { productId: 1, quantity: 2, purchasePrice: 110.5 },
      { productId: 2, quantity: 3, purchasePrice: 80 },
    ]);
    expect(res.status).toBe(201);
    expect((await product(1)).purchasePrice).toBe(110.5);
    expect((await product(2)).purchasePrice).toBe(80);
    expect((await product(2)).stockQuantity).toBe(other.stockQuantity + 3);
    const invoice = (await admin.get(`/purchase-invoices/${res.body.data.purchaseInvoiceId}`)).body
      .data;
    // 221 + 240 = 461 taxable, 18% = 82.98, rounded to the rupee.
    expect(invoice).toMatchObject({ subtotal: 461, totalTax: 82.98, roundOff: 0.02 });
    expect(invoice.grandTotal).toBe(544);
  });

  it('records stock received without a bill as an internal invoice with no tax', async () => {
    const res = await stockIn(admin, [{ productId: 2, quantity: 1 }], {
      noBill: true,
      invoiceNumber: null,
    });
    expect(res.status).toBe(201);
    const invoice = (await admin.get(`/purchase-invoices/${res.body.data.purchaseInvoiceId}`)).body
      .data;
    expect(invoice).toMatchObject({
      noBill: true,
      supplierInvoiceNumber: null,
      subtotal: 80,
      totalTax: 0,
      grandTotal: 80,
    });
  });

  it('C: rejects invalid prices and quantities without saving anything', async () => {
    const before = await snapshot();
    const attempts = [
      [{ productId: 1, quantity: 5, purchasePrice: -1 }],
      [{ productId: 1, quantity: 5, purchasePrice: 'abc' }],
      [{ productId: 1, quantity: 0, purchasePrice: 100 }],
      [{ productId: 1, quantity: -3 }],
      [
        { productId: 1, quantity: 1, purchasePrice: 100 },
        { productId: 1, quantity: 1, purchasePrice: 120 },
      ],
      [{ productId: 99999, quantity: 1, purchasePrice: 10 }],
    ];
    for (const items of attempts) {
      const res = await stockIn(admin, items);
      expect(res.status, JSON.stringify(items)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    // Purchase prices have no place on a Stock OUT.
    const out = await admin.post('/stock-movements', {
      type: 'OUT',
      noBill: true,
      items: [{ productId: 1, quantity: 1, purchasePrice: 5 }],
    });
    expect(out.status).toBe(422);
    expect(await snapshot()).toEqual(before);
  });

  it('D: a repeated submit returns the saved entry instead of booking it twice', async () => {
    const before = await snapshot();
    const body = [{ productId: 1, quantity: 4, purchasePrice: 120 }];
    const clientRequestId = randomUUID();

    const first = await stockIn(admin, body, { clientRequestId });
    expect(first.status).toBe(201);
    const again = await stockIn(admin, body, { clientRequestId });
    expect(again.status).toBe(200);
    expect(again.body.message).toContain('already saved');
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(again.body.data.purchaseInvoiceNo).toBe(first.body.data.purchaseInvoiceNo);

    // Two identical requests at the same moment are booked once as well.
    const racedId = randomUUID();
    const raced = await Promise.all([
      stockIn(admin, body, { clientRequestId: racedId }),
      stockIn(admin, body, { clientRequestId: racedId }),
    ]);
    expect(raced.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(raced[0].body.data.id).toBe(raced[1].body.data.id);

    const after = await snapshot();
    expect(after.stock).toBe(before.stock + 8);
    expect(after.entries).toBe(before.entries + 2);
    expect(after.invoices).toBe(before.invoices + 2);

    // Another user cannot reuse the request id.
    const other = await stockIn(warehouse, [{ productId: 1, quantity: 1 }], { clientRequestId });
    expect(other.status).toBe(409);
  });

  it('E: if the invoice cannot be created, stock and price are rolled back too', async () => {
    const before = await snapshot();
    // Occupy the next invoice number so creating the invoice fails inside the transaction.
    const taken = await db('purchase_invoices').orderBy('id', 'desc').first();
    const next = taken.invoice_no.replace(/\d+$/, (n) => String(Number(n) + 1).padStart(4, '0'));
    await db('purchase_invoices').where({ id: taken.id }).update({ invoice_no: next });

    const res = await stockIn(admin, [{ productId: 1, quantity: 7, purchasePrice: 999 }]);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await snapshot()).toEqual(before);
    expect(await db('product_price_history').where({ new_price: 999 })).toEqual([]);

    await db('purchase_invoices').where({ id: taken.id }).update({ invoice_no: taken.invoice_no });
    expect((await stockIn(admin, [{ productId: 1, quantity: 1 }])).status).toBe(201);
  });

  it('lets only permitted users change prices; others invoice at the current price', async () => {
    const before = await product(1);
    const denied = await stockIn(warehouse, [{ productId: 1, quantity: 1, purchasePrice: 1 }]);
    expect(denied.status).toBe(403);
    expect((await product(1)).stockQuantity).toBe(before.stockQuantity);

    const ok = await stockIn(warehouse, [{ productId: 1, quantity: 1 }]);
    expect(ok.status).toBe(201);
    expect(ok.body.data.items[0].purchasePrice).toBe(before.purchasePrice);
    expect((await product(1)).purchasePrice).toBe(before.purchasePrice);

    // The Stock IN search shows the purchase price only to those who may change it.
    const search = (client) => client.get('/products/search?q=JCB-HF-001');
    expect((await search(admin)).body.data[0].purchasePrice).toBe(before.purchasePrice);
    expect((await search(warehouse)).body.data[0]).not.toHaveProperty('purchasePrice');
  });

  it('leaves Stock OUT without prices or an invoice', async () => {
    const invoices = await count('purchase_invoices');
    const res = await admin.post('/stock-movements', {
      type: 'OUT',
      noBill: true,
      items: [{ productId: 1, quantity: 1 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ purchaseInvoiceId: null, purchaseInvoiceNo: null });
    expect(res.body.data.items[0].purchasePrice).toBeNull();
    expect(await count('purchase_invoices')).toBe(invoices);
  });

  describe('F: billing invoice list and payments', () => {
    it('lists, searches and filters invoices of the branch', async () => {
      const all = await admin.get('/purchase-invoices?limit=50');
      expect(all.status).toBe(200);
      expect(all.body.meta.total).toBe(await count('purchase_invoices'));
      expect(all.body.data[0]).toEqual(
        expect.objectContaining({
          invoiceNo: expect.stringMatching(/^PI\//),
          movementNo: expect.stringMatching(/^SI\//),
          grandTotal: expect.any(Number),
          paidAmount: 0,
          paymentStatus: 'UNPAID',
        }),
      );

      const byEntry = await admin.get(
        `/purchase-invoices?search=${encodeURIComponent(entry.movementNo)}`,
      );
      expect(byEntry.body.data.map((i) => i.id)).toEqual([entry.purchaseInvoiceId]);
      const bySupplierBill = await admin.get('/purchase-invoices?search=SUP-1001&limit=50');
      expect(bySupplierBill.body.data.every((i) => i.supplierInvoiceNumber === 'SUP-1001')).toBe(
        true,
      );
      expect((await admin.get('/purchase-invoices?from=2999-01-01')).body.data).toEqual([]);
      expect((await admin.get('/purchase-invoices?paymentStatus=PAID')).body.data).toEqual([]);

      // Invoices belong to the branch they were received in.
      const elsewhere = await admin.get('/purchase-invoices').set('X-Branch-Id', '2');
      expect(elsewhere.body.data).toEqual([]);
      const hidden = await admin
        .get(`/purchase-invoices/${entry.purchaseInvoiceId}`)
        .set('X-Branch-Id', '2');
      expect(hidden.status).toBe(404);
    });

    it('records payments and derives the payment status', async () => {
      const pay = (paidAmount) =>
        admin.patch(`/purchase-invoices/${entry.purchaseInvoiceId}/payment`, { paidAmount });

      const part1 = await pay(2000);
      expect(part1.status).toBe(200);
      expect(part1.body.data).toMatchObject({
        paidAmount: 2000,
        outstandingAmount: 4785,
        paymentStatus: 'PARTIAL',
      });
      expect((await pay(6785)).body.data).toMatchObject({
        outstandingAmount: 0,
        paymentStatus: 'PAID',
      });
      expect((await pay(6786)).status).toBe(422);
      expect((await pay(-1)).status).toBe(422);
      expect((await admin.get('/purchase-invoices?paymentStatus=PAID')).body.data).toHaveLength(1);
    });

    it('is closed to users without the billing invoice permissions', async () => {
      const salesman = await as(SALESMAN);
      for (const client of [warehouse, salesman]) {
        expect((await client.get('/purchase-invoices')).status).toBe(403);
        expect((await client.get(`/purchase-invoices/${entry.purchaseInvoiceId}`)).status).toBe(
          403,
        );
        expect(
          (
            await client.patch(`/purchase-invoices/${entry.purchaseInvoiceId}/payment`, {
              paidAmount: 1,
            })
          ).status,
        ).toBe(403);
      }
    });
  });
});
