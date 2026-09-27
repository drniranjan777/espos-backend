import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, SALESMAN, WAREHOUSE, as } from '../helpers/api.js';
import { db, resetDatabase } from '../helpers/db.js';

// Seed data: company in Maharashtra (27). Customer 1 = Maharashtra, customer 2 = Karnataka (29).
// Product 1 = Hydraulic Filter, selling 850, GST 18%, opening stock 42.
const HYDRAULIC_FILTER = 1;
const OIL_FILTER = 2;
const MH_CUSTOMER = 1;
const KA_CUSTOMER = 2;

let admin;
let salesman;
let warehouse;

async function stockOf(id) {
  return (await admin.get(`/products/${id}`)).body.data.stockQuantity;
}

beforeAll(async () => {
  await resetDatabase();
  [admin, salesman, warehouse] = await Promise.all([as(ADMIN), as(SALESMAN), as(WAREHOUSE)]);
});
afterAll(() => db.destroy());

describe('invoice totals', () => {
  it('computes CGST + SGST for an intra-state customer using server-side prices and rates', async () => {
    const res = await salesman.post('/invoices', {
      customerId: MH_CUSTOMER,
      items: [{ productId: HYDRAULIC_FILTER, quantity: 2 }],
    });
    expect(res.status).toBe(201);
    const invoice = res.body.data;
    expect(invoice).toMatchObject({
      status: 'DRAFT',
      invoiceNo: null,
      supplyType: 'INTRA',
      taxableAmount: 1700,
      cgstAmount: 153,
      sgstAmount: 153,
      igstAmount: 0,
      grandTotal: 2006,
      customerName: 'Ramesh Patil',
      customerGstin: '27AAPFP1234C1Z5',
    });
    expect(invoice.items[0]).toMatchObject({
      productName: 'Hydraulic Filter',
      hsnCode: '84212300',
      rate: 850,
      gstRate: 18,
    });
  });

  it('computes IGST for an inter-state customer', async () => {
    const res = await salesman.post('/invoices', {
      customerId: KA_CUSTOMER,
      items: [{ productId: HYDRAULIC_FILTER, quantity: 1, rate: 800, discountPercent: 5 }],
    });
    expect(res.body.data).toMatchObject({
      supplyType: 'INTER',
      subtotal: 800,
      totalDiscount: 40,
      taxableAmount: 760,
      igstAmount: 136.8,
      cgstAmount: 0,
      roundOff: 0.2,
      grandTotal: 897,
    });
  });

  it('ignores totals sent by the client', async () => {
    const res = await salesman.post('/invoices', {
      customerId: MH_CUSTOMER,
      grandTotal: 1,
      items: [{ productId: HYDRAULIC_FILTER, quantity: 1, gstRate: 0, lineTotal: 1 }],
    });
    expect(res.body.data.grandTotal).toBe(1003);
    expect(res.body.data.items[0].gstRate).toBe(18);
  });

  it('validates the payload', async () => {
    const noItems = await salesman.post('/invoices', { customerId: MH_CUSTOMER, items: [] });
    expect(noItems.status).toBe(422);
    const badQty = await salesman.post('/invoices', {
      customerId: MH_CUSTOMER,
      items: [{ productId: HYDRAULIC_FILTER, quantity: 0 }],
    });
    expect(badQty.status).toBe(422);
    const future = await salesman.post('/invoices', {
      customerId: MH_CUSTOMER,
      invoiceDate: '2999-01-01',
      items: [{ productId: HYDRAULIC_FILTER, quantity: 1 }],
    });
    expect(future.status).toBe(422);
    const unknownProduct = await salesman.post('/invoices', {
      customerId: MH_CUSTOMER,
      items: [{ productId: 99999, quantity: 1 }],
    });
    expect(unknownProduct.status).toBe(400);
  });
});

describe('invoice lifecycle', () => {
  it('drafts do not touch stock; finalizing assigns a number and deducts stock', async () => {
    const before = await stockOf(HYDRAULIC_FILTER);
    const draft = (
      await salesman.post('/invoices', {
        customerId: MH_CUSTOMER,
        invoiceDate: '2026-09-27',
        items: [
          { productId: HYDRAULIC_FILTER, quantity: 3 },
          { productId: OIL_FILTER, quantity: 1 },
        ],
      })
    ).body.data;
    expect(await stockOf(HYDRAULIC_FILTER)).toBe(before);

    const res = await salesman.post(`/invoices/${draft.id}/finalize`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('FINAL');
    expect(res.body.data.invoiceNo).toBe('INV/2026-27/0001');
    expect(res.body.data.companySnapshot.companyName).toBe('Shree Ganesh Machinery Spares');
    expect(await stockOf(HYDRAULIC_FILTER)).toBe(before - 3);

    const ledger = (
      await admin.get(`/inventory/ledger?productId=${HYDRAULIC_FILTER}&types=INVOICE_OUT`)
    ).body.data;
    expect(ledger[0]).toMatchObject({
      referenceNo: 'INV/2026-27/0001',
      quantity: -3,
      customerName: 'Ramesh Patil',
    });
  });

  it('numbers invoices sequentially and can create + finalize in one call', async () => {
    const res = await salesman.post('/invoices', {
      customerId: KA_CUSTOMER,
      invoiceDate: '2026-09-27',
      finalize: true,
      items: [{ productId: OIL_FILTER, quantity: 1 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.invoiceNo).toBe('INV/2026-27/0002');
  });

  it('restarts numbering in a new financial year', async () => {
    const res = await salesman.post('/invoices', {
      customerId: MH_CUSTOMER,
      invoiceDate: '2026-03-31',
      finalize: true,
      items: [{ productId: OIL_FILTER, quantity: 1 }],
    });
    expect(res.body.data.invoiceNo).toBe('INV/2025-26/0001');
  });

  it('refuses to finalize when stock is insufficient, leaving the draft and stock unchanged', async () => {
    const before = await stockOf(HYDRAULIC_FILTER);
    const draft = (
      await salesman.post('/invoices', {
        customerId: MH_CUSTOMER,
        items: [
          { productId: OIL_FILTER, quantity: 1 },
          { productId: HYDRAULIC_FILTER, quantity: before + 1 },
        ],
      })
    ).body.data;
    const oilBefore = await stockOf(OIL_FILTER);

    const res = await salesman.post(`/invoices/${draft.id}/finalize`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');

    // Whole transaction rolled back: no number consumed, no partial stock movement.
    expect(await stockOf(OIL_FILTER)).toBe(oilBefore);
    const reloaded = (await admin.get(`/invoices/${draft.id}`)).body.data;
    expect(reloaded.status).toBe('DRAFT');
    const next = await salesman.post('/invoices', {
      customerId: MH_CUSTOMER,
      invoiceDate: '2026-09-27',
      finalize: true,
      items: [{ productId: OIL_FILTER, quantity: 1 }],
    });
    expect(next.body.data.invoiceNo).toBe('INV/2026-27/0003');
  });

  it('checks the same product across multiple lines against stock', async () => {
    const stock = await stockOf(OIL_FILTER);
    const res = await salesman.post('/invoices', {
      customerId: MH_CUSTOMER,
      finalize: true,
      items: [
        { productId: OIL_FILTER, quantity: stock },
        { productId: OIL_FILTER, quantity: 1 },
      ],
    });
    expect(res.status).toBe(409);
    expect(await stockOf(OIL_FILTER)).toBe(stock);
  });

  it('cannot finalize twice, even concurrently', async () => {
    const draft = (
      await salesman.post('/invoices', {
        customerId: MH_CUSTOMER,
        items: [{ productId: OIL_FILTER, quantity: 1 }],
      })
    ).body.data;
    const before = await stockOf(OIL_FILTER);
    const results = await Promise.all([
      salesman.post(`/invoices/${draft.id}/finalize`),
      salesman.post(`/invoices/${draft.id}/finalize`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stockOf(OIL_FILTER)).toBe(before - 1);
  });

  it('edits drafts only', async () => {
    const draft = (
      await salesman.post('/invoices', {
        customerId: MH_CUSTOMER,
        items: [{ productId: OIL_FILTER, quantity: 1 }],
      })
    ).body.data;
    const edited = await salesman.put(`/invoices/${draft.id}`, {
      customerId: KA_CUSTOMER,
      items: [{ productId: OIL_FILTER, quantity: 2 }],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ customerId: KA_CUSTOMER, supplyType: 'INTER' });
    expect(edited.body.data.items[0].quantity).toBe(2);

    await salesman.post(`/invoices/${draft.id}/finalize`);
    const again = await salesman.put(`/invoices/${draft.id}`, {
      customerId: MH_CUSTOMER,
      items: [{ productId: OIL_FILTER, quantity: 1 }],
    });
    expect(again.status).toBe(409);
  });

  it('cancelling restores stock and keeps the number', async () => {
    const invoice = (
      await salesman.post('/invoices', {
        customerId: MH_CUSTOMER,
        finalize: true,
        items: [{ productId: HYDRAULIC_FILTER, quantity: 2 }],
      })
    ).body.data;
    const afterSale = await stockOf(HYDRAULIC_FILTER);

    expect((await salesman.post(`/invoices/${invoice.id}/cancel`, { reason: 'x' })).status).toBe(
      403,
    );
    expect((await admin.post(`/invoices/${invoice.id}/cancel`, {})).status).toBe(422);

    const res = await admin.post(`/invoices/${invoice.id}/cancel`, {
      reason: 'Customer returned order',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'CANCELLED', invoiceNo: invoice.invoiceNo });
    expect(await stockOf(HYDRAULIC_FILTER)).toBe(afterSale + 2);

    const twice = await admin.post(`/invoices/${invoice.id}/cancel`, { reason: 'again' });
    expect(twice.status).toBe(409);
  });

  it('deletes drafts but not finalized invoices', async () => {
    const draft = (
      await salesman.post('/invoices', {
        customerId: MH_CUSTOMER,
        items: [{ productId: OIL_FILTER, quantity: 1 }],
      })
    ).body.data;
    expect((await salesman.delete(`/invoices/${draft.id}`)).status).toBe(200);
    expect((await admin.get(`/invoices/${draft.id}`)).status).toBe(404);

    const final = (await admin.get('/invoices?status=FINAL')).body.data[0];
    expect((await admin.delete(`/invoices/${final.id}`)).status).toBe(409);
  });
});

describe('invoice queries and output', () => {
  it('lists with search and status filters', async () => {
    const res = await admin.get('/invoices?search=SK%20Infra&status=FINAL');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((i) => i.status === 'FINAL')).toBe(true);
  });

  it('returns print data: HSN summary and amount in words', async () => {
    const final = (await admin.get('/invoices?status=FINAL&sortBy=invoiceNo&sortOrder=asc')).body
      .data[0];
    const res = await admin.get(`/invoices/${final.id}`);
    expect(res.body.data.hsnSummary.length).toBeGreaterThan(0);
    expect(res.body.data.amountInWords).toMatch(/^Rupees .* Only$/);
    expect(res.body.data.company.companyName).toBeTruthy();
  });

  it('renders a PDF', async () => {
    const final = (await admin.get('/invoices?status=FINAL')).body.data[0];
    const res = await admin
      .get(`/invoices/${final.id}/pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('is not visible to warehouse users', async () => {
    expect((await warehouse.get('/invoices')).status).toBe(403);
    expect((await warehouse.post('/invoices', { customerId: 1, items: [] })).status).toBe(403);
  });
});
