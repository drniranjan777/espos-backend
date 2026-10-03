import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, SALESMAN, WAREHOUSE, as } from '../helpers/api.js';
import { db, resetDatabase } from '../helpers/db.js';

// Demo seed: branch 1 = Hyderabad (default), branch 2 = Vijayawada.
// warehouse user → Hyderabad only; salesman → both; admin → all (branches.all).
// Product 1 (JCB-HF-001): 42 in Hyderabad, 12 in Vijayawada. Product 2 (JCB-OF-002): 60 / 20.
const HYD = 1;
const VJA = 2;

let admin;
let warehouse;
let salesman;

/** Client whose requests target a branch. */
function inBranch(client, branchId) {
  const withBranch = (req) => req.set('X-Branch-Id', String(branchId));
  return {
    get: (url) => withBranch(client.get(url)),
    post: (url, body) => withBranch(client.post(url, body)),
    patch: (url, body) => withBranch(client.patch(url, body)),
  };
}

async function stock(productId, branchId) {
  const res = await inBranch(admin, branchId).get(`/products/${productId}`);
  return res.body.data.stockQuantity;
}

beforeAll(async () => {
  await resetDatabase();
  [admin, warehouse, salesman] = await Promise.all([as(ADMIN), as(WAREHOUSE), as(SALESMAN)]);
});
afterAll(() => db.destroy());

describe('branch access', () => {
  it('lists the branches each user may work in', async () => {
    const names = async (client) =>
      (await client.get('/auth/me')).body.data.branches.map((b) => b.name);
    expect(await names(admin)).toEqual(['Hyderabad', 'Vijayawada']);
    expect(await names(warehouse)).toEqual(['Hyderabad']);
    expect(await names(salesman)).toEqual(['Hyderabad', 'Vijayawada']);
  });

  it('shows stock of the selected branch', async () => {
    expect(await stock(1, HYD)).toBe(42);
    expect(await stock(1, VJA)).toBe(12);
  });

  it('defaults to the first branch and refuses branches the user is not assigned to', async () => {
    expect((await warehouse.get('/products/1')).body.data.stockQuantity).toBe(42);
    const res = await inBranch(warehouse, VJA).get('/products/1');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BRANCH_FORBIDDEN');
    expect((await inBranch(warehouse, 'abc').get('/products/1')).status).toBe(400);
  });

  it('keeps stock movements inside the branch', async () => {
    await inBranch(salesman, VJA).post('/inventory/stock-out', { productId: 1, quantity: 2 });
    expect(await stock(1, VJA)).toBe(10);
    expect(await stock(1, HYD)).toBe(42);
    const ledger = await inBranch(admin, HYD).get('/inventory/ledger?productId=1&types=OUT');
    expect(ledger.body.meta.total).toBe(0);
  });

  it('keeps invoices inside the branch', async () => {
    const invoice = (
      await inBranch(salesman, VJA).post('/invoices', {
        customerId: 1,
        finalize: true,
        items: [{ productId: 2, quantity: 1 }],
      })
    ).body.data;
    expect(await stock(2, VJA)).toBe(19);
    expect(await stock(2, HYD)).toBe(60);
    expect((await inBranch(admin, HYD).get(`/invoices/${invoice.id}`)).status).toBe(404);
    expect((await inBranch(admin, VJA).get(`/invoices/${invoice.id}`)).status).toBe(200);
    const cancel = await inBranch(admin, HYD).post(`/invoices/${invoice.id}/cancel`, {
      reason: 'x',
    });
    expect(cancel.status).toBe(404);
  });
});

describe('branch administration', () => {
  it('creates a branch with stock rows for every product', async () => {
    const res = await admin.post('/branches', {
      code: 'gnt',
      name: 'Guntur',
      stateCode: '37',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: 'GNT', state: 'Andhra Pradesh', isActive: true });
    const rows = await db('inventory').where({ warehouse_id: res.body.data.id }).count({ n: '*' });
    expect(Number(rows[0].n)).toBe(14);
  });

  it('refuses to deactivate the default branch or a branch holding stock', async () => {
    expect((await admin.patch(`/branches/${HYD}`, { isActive: false })).status).toBe(400);
    const res = await admin.patch(`/branches/${VJA}`, { isActive: false });
    expect(res.status).toBe(409);
  });

  it('assigns users to branches', async () => {
    const user = (await admin.get('/users?search=warehouse')).body.data[0];
    expect(user.branchIds).toEqual([HYD]);
    const res = await admin.patch(`/users/${user.id}`, { branchIds: [HYD, VJA] });
    expect(res.body.data.branchIds).toEqual([HYD, VJA]);
    const bad = await admin.patch(`/users/${user.id}`, { branchIds: [999] });
    expect(bad.status).toBe(422);
    await admin.patch(`/users/${user.id}`, { branchIds: [HYD] });
  });

  it('is limited to branches.manage', async () => {
    expect((await warehouse.post('/branches', { code: 'X', name: 'X' })).status).toBe(403);
  });
});

describe('multi-item stock entries', () => {
  it('records several parts as one numbered Stock OUT', async () => {
    const res = await warehouse.post('/stock-movements', {
      type: 'OUT',
      invoiceNumber: 'B-1001',
      partyName: 'Walk-in',
      note: 'Counter',
      items: [
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 3 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'OUT',
      movementNo: expect.stringMatching(/^SO\/\d{4}-\d{2}\/0001$/),
      invoiceNumber: 'B-1001',
      lineCount: 2,
      totalQuantity: 5,
      branchName: 'Hyderabad',
    });
    expect(res.body.data.items[0]).toMatchObject({ productId: 1, quantity: 2, newBalance: 40 });
    expect(await stock(1, HYD)).toBe(40);
  });

  it('is all-or-nothing and reports every short line', async () => {
    const res = await warehouse.post('/stock-movements', {
      type: 'OUT',
      noBill: true,
      items: [
        { productId: 1, quantity: 1 },
        { productId: 9, quantity: 999 },
        { productId: 14, quantity: 1 },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details.lines.map((l) => l.productId)).toEqual([9, 14]);
    expect(await stock(1, HYD)).toBe(40);
  });

  it('merges repeated parts into one line', async () => {
    const res = await warehouse.post('/stock-movements', {
      type: 'IN',
      noBill: true,
      items: [
        { productId: 3, quantity: 1 },
        { productId: 3, quantity: 4 },
      ],
    });
    expect(res.body.data.lineCount).toBe(1);
    expect(res.body.data.items[0].quantity).toBe(5);
  });

  it('requires an invoice number unless "No bill" is on, and clears party details for No bill', async () => {
    const missing = await warehouse.post('/stock-movements', {
      type: 'IN',
      items: [{ productId: 1, quantity: 1 }],
    });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details[0].field).toBe('invoiceNumber');

    const noBill = await warehouse.post('/stock-movements', {
      type: 'IN',
      noBill: true,
      invoiceNumber: 'ignored',
      partyName: 'ignored',
      items: [{ productId: 1, quantity: 1 }],
    });
    expect(noBill.body.data).toMatchObject({ noBill: true, invoiceNumber: null, partyName: null });
  });

  it('uses the customer master for Stock OUT and a supplier name for Stock IN', async () => {
    const out = await salesman.post('/stock-movements', {
      type: 'OUT',
      invoiceNumber: 'B-1002',
      customerId: 2,
      items: [{ productId: 1, quantity: 1 }],
    });
    expect(out.body.data.partyName).toBe('SK Infra Projects');
    const inWithCustomer = await warehouse.post('/stock-movements', {
      type: 'IN',
      invoiceNumber: 'P-1',
      customerId: 2,
      items: [{ productId: 1, quantity: 1 }],
    });
    expect(inWithCustomer.status).toBe(422);
  });

  it('checks IN / OUT permissions separately', async () => {
    const res = await salesman.post('/stock-movements', {
      type: 'IN',
      noBill: true,
      items: [{ productId: 1, quantity: 1 }],
    });
    expect(res.status).toBe(403);
  });

  it('lists entries of the current branch only', async () => {
    const hyd = await admin.get('/stock-movements?type=OUT');
    expect(hyd.body.data.length).toBeGreaterThan(0);
    const vja = await inBranch(admin, VJA).get('/stock-movements');
    expect(vja.body.meta.total).toBe(0);
  });
});

describe('stock transfers', () => {
  async function requestTransfer(items = [{ productId: 2, quantity: 5 }]) {
    const res = await warehouse.post('/transfers', {
      toWarehouseId: VJA,
      invoiceNumber: 'DC-77',
      items,
    });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  it('moves stock only after approval and receipt', async () => {
    const hydBefore = await stock(2, HYD);
    const vjaBefore = await stock(2, VJA);
    const transfer = await requestTransfer();
    expect(transfer).toMatchObject({
      status: 'REQUESTED',
      fromBranchName: 'Hyderabad',
      toBranchName: 'Vijayawada',
      transferNo: expect.stringMatching(/^ST\//),
    });
    expect(await stock(2, HYD)).toBe(hydBefore);

    expect((await warehouse.post(`/transfers/${transfer.id}/approve`)).status).toBe(403);
    const approved = await admin.post(`/transfers/${transfer.id}/approve`);
    expect(approved.body.data.status).toBe('IN_TRANSIT');
    expect(await stock(2, HYD)).toBe(hydBefore - 5);
    expect(await stock(2, VJA)).toBe(vjaBefore);

    // The requester (Hyderabad only) cannot receive at Vijayawada.
    expect((await warehouse.post(`/transfers/${transfer.id}/receive`)).status).toBe(403);
    const received = await admin.post(`/transfers/${transfer.id}/receive`);
    expect(received.body.data.status).toBe('RECEIVED');
    expect(await stock(2, VJA)).toBe(vjaBefore + 5);

    const ledger = await inBranch(admin, VJA).get(
      '/inventory/ledger?productId=2&types=TRANSFER_IN',
    );
    expect(ledger.body.data[0]).toMatchObject({ partyName: 'Hyderabad', quantity: 5 });
  });

  it('returns stock when an in-transit transfer is cancelled', async () => {
    const before = await stock(2, HYD);
    const transfer = await requestTransfer();
    await admin.post(`/transfers/${transfer.id}/approve`);
    expect(await stock(2, HYD)).toBe(before - 5);
    const requesterCancel = await warehouse.post(`/transfers/${transfer.id}/cancel`, {
      reason: 'x',
    });
    expect(requesterCancel.status).toBe(403);
    const res = await admin.post(`/transfers/${transfer.id}/cancel`, {
      reason: 'Truck unavailable',
    });
    expect(res.body.data).toMatchObject({ status: 'CANCELLED', closeReason: 'Truck unavailable' });
    expect(await stock(2, HYD)).toBe(before);
  });

  it('lets the requester withdraw and the approver reject requests', async () => {
    const own = await requestTransfer();
    expect(
      (await warehouse.post(`/transfers/${own.id}/cancel`, { reason: 'Mistake' })).status,
    ).toBe(200);

    const other = await requestTransfer();
    const rejected = await admin.post(`/transfers/${other.id}/reject`, { reason: 'Not needed' });
    expect(rejected.body.data.status).toBe('REJECTED');
    expect((await admin.post(`/transfers/${other.id}/approve`)).status).toBe(409);
    expect((await admin.post(`/transfers/${other.id}/reject`, {})).status).toBe(422);
  });

  it('cannot be approved twice, even concurrently', async () => {
    const before = await stock(2, HYD);
    const transfer = await requestTransfer();
    const results = await Promise.all([
      admin.post(`/transfers/${transfer.id}/approve`),
      admin.post(`/transfers/${transfer.id}/approve`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stock(2, HYD)).toBe(before - 5);
  });

  it('validates the request', async () => {
    const same = await warehouse.post('/transfers', {
      toWarehouseId: HYD,
      items: [{ productId: 2, quantity: 1 }],
    });
    expect(same.status).toBe(422);
    const tooMuch = await warehouse.post('/transfers', {
      toWarehouseId: VJA,
      items: [{ productId: 2, quantity: 99999 }],
    });
    expect(tooMuch.status).toBe(409);
  });

  it('refuses approval when stock has run out since the request', async () => {
    const available = await stock(13, HYD);
    const transfer = await requestTransfer([{ productId: 13, quantity: available }]);
    await warehouse.post('/stock-movements', {
      type: 'OUT',
      noBill: true,
      items: [{ productId: 13, quantity: 1 }],
    });
    const res = await admin.post(`/transfers/${transfer.id}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('lists outgoing and incoming transfers per branch and counts them on the dashboard', async () => {
    const outgoing = await warehouse.get('/transfers?direction=outgoing&status=REQUESTED');
    expect(outgoing.body.data.every((t) => t.fromWarehouseId === HYD)).toBe(true);
    const incoming = await inBranch(admin, VJA).get('/transfers?direction=incoming');
    expect(incoming.body.data.every((t) => t.toWarehouseId === VJA)).toBe(true);

    const pending = (await admin.get('/dashboard/summary')).body.data.transfers;
    expect(pending.awaitingApproval).toBeGreaterThan(0);
  });

  it('records each step in the audit log', async () => {
    const actions = (await db('audit_logs').where({ module: 'transfers' }).select('action')).map(
      (r) => r.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['CREATE', 'APPROVE', 'RECEIVE', 'REJECT', 'CANCEL']),
    );
  });
});
