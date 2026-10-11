import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, SALESMAN, WAREHOUSE, as } from '../helpers/api.js';
import { db, resetDatabase } from '../helpers/db.js';

// Demo seed (Hyderabad = branch 1, Vijayawada = 2): Hydraulic Filter 42 / 12 (min 10),
// Fuel Filter 8 (min 15), Hydraulic Pump Seal Kit 4 (min 5), Water Pump 0.
// warehouse user: Hyderabad only, no customers or reports; salesman: both branches,
// customers and invoices, no reports.

let admin;
let warehouse;
let salesman;

const ask = (client, message, context, branchId, language) => {
  const req = client.post('/ask-stock', { message, context, language });
  return branchId ? req.set('X-Branch-Id', String(branchId)) : req;
};
const reply = async (...args) => {
  const res = await ask(...args);
  expect(res.status).toBe(200);
  return res.body.data;
};

beforeAll(async () => {
  await resetDatabase();
  [admin, warehouse, salesman] = await Promise.all([as(ADMIN), as(WAREHOUSE), as(SALESMAN)]);
});
afterAll(() => db.destroy());

describe('POST /ask-stock', () => {
  it('requires sign-in and a question', async () => {
    const { request, app } = await import('../helpers/api.js');
    expect((await request(app).post('/api/v1/ask-stock').send({ message: 'hi' })).status).toBe(401);
    expect((await ask(admin, '  ')).status).toBe(422);
    expect((await ask(admin, 'x'.repeat(301))).status).toBe(422);
  });

  it('answers the stock of one part with stock in every branch', async () => {
    const data = await reply(admin, 'Hydraulic filter, how many in stock?');
    expect(data.reply).toContain('42 PCS in Hyderabad');
    const card = data.cards[0];
    expect(card.type).toBe('part');
    expect(card.part.branches).toEqual([
      expect.objectContaining({ branchName: 'Hyderabad', quantity: 42, isCurrent: true }),
      expect.objectContaining({ branchName: 'Vijayawada', quantity: 12, isCurrent: false }),
    ]);
    expect(data.context).toEqual({ productId: 1, productName: 'Hydraulic Filter' });
  });

  it('answers questions asked in Telugu and Hindi', async () => {
    expect((await reply(admin, 'హైడ్రాలిక్ ఫిల్టర్ ఎన్ని ఉన్నాయి')).reply).toContain(
      '42 PCS in Hyderabad',
    );
    expect((await reply(admin, 'హైడ్రాలిక్ ఫిల్టర్ ధర ఎంత')).reply).toContain('₹850');
    expect((await reply(admin, 'हाइड्रोलिक फ़िल्टर कितने हैं')).reply).toContain('42 PCS');
  });

  it('follows up on the part discussed last', async () => {
    const context = { productId: 1 };
    expect((await reply(admin, 'and in Vijayawada?', context)).reply).toContain(
      '12 PCS in Vijayawada',
    );
    expect((await reply(admin, 'iska price kya hai', context)).reply).toContain('₹850');
  });

  it('shows only branches the user may see', async () => {
    const data = await reply(warehouse, 'hydraulic filter stock');
    expect(data.cards[0].part.branches.map((b) => b.branchName)).toEqual(['Hyderabad']);
    expect((await reply(warehouse, 'in Vijayawada?', { productId: 1 })).reply).toBeTruthy();
  });

  it('answers a stock question in the selected branch', async () => {
    const data = await reply(salesman, 'hydraulic filter', null, 2);
    expect(data.reply).toContain('12 PCS in Vijayawada');
  });

  it('hides the purchase price from users without reports access', async () => {
    const forAdmin = await reply(admin, 'price of hydraulic filter');
    expect(forAdmin.reply).toContain('Purchase price ₹620');
    expect(forAdmin.cards[0].part.purchasePrice).toBe(620);
    const forSales = await reply(salesman, 'price of hydraulic filter');
    expect(forSales.reply).not.toContain('Purchase');
    expect(forSales.cards[0].part).not.toHaveProperty('purchasePrice');
  });

  it('lists choices when several parts match and closest matches for misspellings', async () => {
    const many = await reply(admin, 'filter stock');
    expect(many.cards[0].type).toBe('parts');
    expect(many.cards[0].parts.length).toBeGreaterThan(1);
    const close = await reply(admin, 'hydrolic filtar');
    expect(close.reply).toMatch(/closest|Closest/);
  });

  it('says when nothing matches', async () => {
    const data = await reply(admin, 'zzzz qqqq');
    expect(data.reply).toContain('couldn’t find');
    expect(data.cards).toEqual([]);
  });

  it('lists out of stock and low stock parts', async () => {
    const out = await reply(admin, 'What is out of stock?');
    expect(out.cards[0].parts.map((p) => p.name)).toEqual(['Water Pump']);
    const low = await reply(admin, 'low stock');
    expect(low.cards[0].parts.map((p) => p.name)).toEqual(
      expect.arrayContaining(['Fuel Filter', 'Hydraulic Pump Seal Kit']),
    );
  });

  it('suggests reorders with quantities', async () => {
    const data = await reply(admin, 'What should I reorder this week?');
    const rows = data.cards[0].rows;
    const fuel = rows.find((r) => r.part === 'Fuel Filter');
    // No usage yet: order up to the minimum level (15 − 8 = 7).
    expect(fuel.order).toBe('7 PCS');
    expect(rows.map((r) => r.part)).toContain('Water Pump');
    expect(rows.map((r) => r.part)).not.toContain('Hydraulic Filter');
  });

  it('counts recent usage in reorder suggestions', async () => {
    // 36 out of 42 hydraulic filters leaves 6 against a minimum of 10.
    await admin.post('/inventory/stock-out', { productId: 1, quantity: 36 });
    const rows = (await reply(admin, 'reorder')).cards[0].rows;
    const filter = rows.find((r) => r.part === 'Hydraulic Filter');
    // Usage 36/30 = 1.2 a day; 14 days = 16.8; 10 + 16.8 − 6 = 20.8 → 21.
    expect(filter.order).toBe('21 PCS');
  });

  it('lists parts that have not moved', async () => {
    // Stock received today has not been held long enough to count as not moving.
    expect((await reply(admin, 'Which parts have not moved in two months?')).cards).toEqual([]);

    // Grease held since 90 days ago and never sold shows up; parts sold recently do not.
    await db('inventory_transactions').insert({
      warehouse_id: 1,
      product_id: 12,
      type: 'OPENING',
      quantity: 1,
      previous_balance: 0,
      new_balance: 1,
      txn_date: db.raw('CURRENT_DATE - 90'),
      created_by: 1,
    });
    const data = await reply(admin, 'Which parts have not moved in two months?');
    expect(data.cards[0].rows).toEqual([
      expect.objectContaining({ part: 'Grease EP2', stock: '90 KG', lastOut: 'Never' }),
    ]);
    expect(data.cards[0].columns.map((c) => c.key)).toContain('value');
    const forSales = await reply(salesman, 'non moving parts');
    expect(forSales.cards[0].columns.map((c) => c.key)).not.toContain('value');
  });

  it('lists parts for a machine', async () => {
    const data = await reply(admin, 'parts for PC200');
    expect(data.cards[0].parts.map((p) => p.name)).toEqual(['Track Roller']);
  });

  it('answers what a customer bought, for users who may see customers', async () => {
    await salesman.post('/invoices', {
      customerId: 1,
      finalize: true,
      items: [{ productId: 5, quantity: 3 }],
    });
    const data = await reply(salesman, 'What did Patil Earthmovers buy this month?');
    expect(data.reply).toContain('Patil Earthmovers');
    expect(data.reply).toContain('1 invoice');
    expect(data.cards[0].rows[0]).toMatchObject({ part: 'Bucket Tooth', quantity: '3 PCS' });
    // A customer name alone also works.
    expect((await reply(salesman, 'Patil Earthmovers')).reply).toContain('Patil Earthmovers');
    expect((await reply(warehouse, 'What did Patil Earthmovers buy?')).reply).toContain(
      'don’t have access',
    );
  });

  it('summarises today', async () => {
    const data = await reply(admin, 'today summary');
    expect(data.reply).toContain('Today in Hyderabad');
    expect(data.reply).toContain('1 invoice');
  });

  it('explains what it can do', async () => {
    expect((await reply(admin, 'help')).suggestions.length).toBeGreaterThan(0);
    expect((await reply(admin, 'what is the weather')).reply).toBeTruthy();
  });
});

// Runs after the tests above: 36 Hydraulic Filters (6 left) and 3 Bucket Teeth went out of
// Hyderabad today; Vijayawada is untouched (12 and 40).
describe('POST /ask-stock — languages and more questions', () => {
  it('answers in the language asked for', async () => {
    const hindi = await reply(admin, 'hydraulic filter stock', null, null, 'hi');
    expect(hindi.language).toBe('hi');
    expect(hindi.reply).toContain('Hyderabad में 6 PCS स्टॉक में है');
    expect(hindi.suggestions).toContain('Hydraulic Filter का दाम?');

    const telugu = await reply(admin, 'hydraulic filter stock', null, null, 'te');
    expect(telugu.reply).toContain('Hyderabadలో 6 PCS');
    expect((await reply(admin, 'hydraulic filter stock')).language).toBe('en');
    expect((await ask(admin, 'hydraulic filter', null, null, 'fr')).status).toBe(422);
  });

  it('localises list answers and their tables', async () => {
    const data = await reply(admin, 'इस हफ्ते क्या ऑर्डर करना है?', null, null, 'hi');
    expect(data.reply).toContain('न्यूनतम स्तर');
    expect(data.cards[0].title).toBe('इस हफ्ते मंगाएं');
    expect(data.cards[0].columns.map((c) => c.label)).toContain('ऑर्डर');
    const telugu = await reply(admin, 'ఏ పార్ట్స్ స్టాక్ అయిపోయాయి?', null, null, 'te');
    expect(telugu.cards[0].title).toBe('స్టాక్ అయిపోయినవి');
    expect(telugu.cards[0].parts.map((p) => p.name)).toEqual(['Water Pump']);
  });

  it('understands a branch named in Hindi or Telugu', async () => {
    const hindi = await reply(
      admin,
      'विजयवाड़ा ब्रांच में हाइड्रोलिक फ़िल्टर कितने स्टॉक में हैं?',
      null,
      null,
      'hi',
    );
    expect(hindi.reply).toContain('Vijayawada में 12 PCS');
    const telugu = await reply(
      admin,
      'విజయవాడ బ్రాంచ్‌లో హైడ్రాలిక్ ఫిల్టర్ ఎన్ని ఉన్నాయి?',
      null,
      null,
      'te',
    );
    expect(telugu.reply).toContain('Vijayawadaలో 12 PCS');
  });

  it('lists what came in and what went out today', async () => {
    const out = await reply(admin, "Show today's stock sales");
    expect(out.reply).toContain('39 units went out of Hyderabad');
    expect(out.cards[0].rows[0]).toMatchObject({ part: 'Hydraulic Filter', quantity: '36 PCS' });
    const received = await reply(admin, "Show today's stock received");
    expect(received.reply).toContain('came in to Hyderabad');
    expect(received.cards[0].title).toBe('Stock in today');
  });

  it('answers how many of a part were sold, keeping the part from the last answer', async () => {
    const first = await reply(admin, 'hydraulic filter stock');
    const sold = await reply(admin, 'How many were sold this month?', first.context);
    expect(sold.reply).toContain('36 PCS of Hydraulic Filter went out of Hyderabad');
    expect(sold.context).toEqual(first.context);
    const none = await reply(admin, 'track roller sold in last 30 days');
    expect(none.reply).toContain('No Track Roller went out');
  });

  it('lists the fastest-moving parts', async () => {
    const data = await reply(admin, 'fast moving parts this month');
    expect(data.cards[0].rows.map((r) => r.part).slice(0, 2)).toEqual([
      'Hydraulic Filter',
      'Bucket Tooth',
    ]);
    // Without a part in mind, a "sold" question shows the same list.
    expect((await reply(admin, 'what sold this month')).cards[0].title).toContain('Top movers');
  });

  it('compares the branches the user may see', async () => {
    const data = await reply(admin, 'Compare stock between Hyderabad and other branches');
    const rows = data.cards[0].rows;
    expect(rows.map((r) => r.branch)).toEqual(['Hyderabad', 'Vijayawada']);
    expect(rows[0]).toMatchObject({ highlight: true, out: '1' });
    expect(data.cards[0].columns.map((c) => c.key)).toContain('value');

    const forWarehouse = await reply(warehouse, 'compare branches');
    expect(forWarehouse.cards[0].rows.map((r) => r.branch)).toEqual(['Hyderabad']);
    const forSales = await reply(salesman, 'compare branches');
    expect(forSales.cards[0].columns.map((c) => c.key)).not.toContain('value');
  });

  it('says which branch has the most of a part', async () => {
    const data = await reply(admin, 'Which branch has the most stock?', { productId: 5 });
    expect(data.reply).toContain('Hyderabad has the most (117 PCS)');
    // With no part in mind the branches are compared instead.
    expect((await reply(admin, 'Which branch has the most stock?')).cards[0].title).toBe(
      'Branch comparison',
    );
  });

  it('totals stock by category and reports transfers', async () => {
    const categories = await reply(admin, 'stock by category');
    expect(categories.cards[0].rows.map((r) => r.category)).toContain('Filters');
    const transfers = await reply(admin, 'pending transfers');
    expect(transfers.reply).toContain('0 transfers are waiting for approval');
    expect((await reply(salesman, 'pending transfers')).reply).toContain('don’t have access');
  });
});

describe('Ask Stock suggestions and preferences', () => {
  it('suggests starter questions in the chosen language, by permission', async () => {
    const hindi = (await admin.get('/ask-stock/suggestions?language=hi')).body.data;
    expect(hindi).toContain('इस हफ्ते क्या ऑर्डर करना है?');
    expect(hindi).toContain('सभी ब्रांच के स्टॉक की तुलना करो');
    const forWarehouse = (await warehouse.get('/ask-stock/suggestions')).body.data;
    expect(forWarehouse).toContain('What should I reorder this week?');
    // One branch only: nothing to compare.
    expect(forWarehouse).not.toContain('Compare stock across branches');
    expect((await admin.get('/ask-stock/suggestions?language=xx')).status).toBe(422);
  });

  it("remembers each user's language", async () => {
    expect((await salesman.get('/ask-stock/preferences')).body.data).toEqual({ language: null });
    const saved = await salesman.put('/ask-stock/preferences', { language: 'te' });
    expect(saved.status).toBe(200);
    expect((await salesman.get('/ask-stock/preferences')).body.data).toEqual({ language: 'te' });
    expect((await admin.get('/ask-stock/preferences')).body.data).toEqual({ language: null });
    expect((await salesman.put('/ask-stock/preferences', { language: 'fr' })).status).toBe(422);
  });
});
