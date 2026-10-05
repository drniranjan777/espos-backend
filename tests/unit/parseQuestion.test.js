import { describe, expect, it } from 'vitest';
import {
  INTENT,
  parsePeriodDays,
  parseQuestion,
} from '../../src/services/askStock/parseQuestion.js';

const BRANCHES = [
  { id: 1, name: 'Hyderabad', code: 'HYD' },
  { id: 2, name: 'Vijayawada', code: 'VJA' },
];
const ask = (message) => parseQuestion(message, { branches: BRANCHES });

describe('parseQuestion', () => {
  it('reads a part stock question', () => {
    expect(ask('PC200 6 hole idler ITR, how many in stock?')).toMatchObject({
      intent: INTENT.STOCK_CHECK,
      query: 'pc200 6 hole idler itr',
      branchId: null,
    });
    expect(ask('hydraulic filter')).toMatchObject({
      intent: INTENT.STOCK_CHECK,
      query: 'hydraulic filter',
    });
  });

  it('reads the suggested list questions with their periods', () => {
    expect(ask('What should I reorder this week?')).toMatchObject({
      intent: INTENT.REORDER,
      periodDays: 7,
    });
    expect(ask('Which parts have not moved in two months?')).toMatchObject({
      intent: INTENT.NON_MOVING,
      periodDays: 60,
    });
    expect(ask('कौन सा पार्ट दो महीने से नहीं बिका')).toMatchObject({
      intent: INTENT.NON_MOVING,
      periodDays: 60,
    });
    expect(ask('What is out of stock?').intent).toBe(INTENT.OUT_OF_STOCK);
    expect(ask('low stock').intent).toBe(INTENT.LOW_STOCK);
  });

  it('does not mistake part words for intents', () => {
    // "idler" contains "idle"; "this week" is a period, not a follow-up.
    expect(ask('idler stock').intent).toBe(INTENT.STOCK_CHECK);
    expect(ask('What should I reorder this week?').followUp).toBe(false);
  });

  it('keeps a stock question about one part when it says "out of stock"', () => {
    expect(ask('is fuel filter out of stock')).toMatchObject({
      intent: INTENT.STOCK_CHECK,
      query: 'fuel filter',
    });
  });

  it('reads branch, price and follow-up questions', () => {
    expect(ask('and in Vijayawada?')).toMatchObject({
      intent: INTENT.STOCK_CHECK,
      branchId: 2,
      followUp: true,
      query: '',
    });
    expect(ask('iska price kya hai')).toMatchObject({ intent: INTENT.PRICE, followUp: true });
    expect(ask('Which branch has bucket tooth?')).toMatchObject({
      intent: INTENT.WHERE_STOCK,
      query: 'bucket tooth',
    });
  });

  it('reads machine, customer, today and help questions', () => {
    expect(ask('parts for PC200')).toMatchObject({
      intent: INTENT.MACHINE_PARTS,
      query: 'pc200',
    });
    expect(ask('What did Patil Earthmovers buy this month?')).toMatchObject({
      intent: INTENT.CUSTOMER,
      query: 'patil earthmovers',
    });
    expect(ask('sales today').intent).toBe(INTENT.TODAY);
    expect(ask('hello').intent).toBe(INTENT.HELP);
    expect(ask('').intent).toBe(INTENT.UNKNOWN);
  });
});

describe('parsePeriodDays', () => {
  it('converts spoken periods to days', () => {
    expect(parsePeriodDays('60 days')).toBe(60);
    expect(parsePeriodDays('3 hafte')).toBe(21);
    expect(parsePeriodDays('last month')).toBe(30);
    expect(parsePeriodDays('100 years')).toBe(730);
    expect(parsePeriodDays('hydraulic filter')).toBeNull();
  });
});
