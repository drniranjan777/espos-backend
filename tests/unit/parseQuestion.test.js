import { describe, expect, it } from 'vitest';
import {
  INTENT,
  parsePeriodDays,
  parseQuestion,
} from '../../src/services/askStock/parseQuestion.js';
import { LANGUAGES, MESSAGES } from '../../src/services/askStock/messages.js';

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

describe('parseQuestion in Telugu', () => {
  it('reads Telugu stock, price and follow-up questions', () => {
    expect(ask('పీసీ 200 ట్రాక్ రోలర్ ఎన్ని ఉన్నాయి')).toMatchObject({
      intent: INTENT.STOCK_CHECK,
      query: 'pc200 track roller',
    });
    expect(ask('హైడ్రాలిక్ ఫిల్టర్ ధర ఎంత')).toMatchObject({
      intent: INTENT.PRICE,
      query: 'hydraulic filter',
    });
    expect(ask('బకెట్ టూత్ ఎక్కడ ఉంది')).toMatchObject({
      intent: INTENT.WHERE_STOCK,
      query: 'bucket tooth',
    });
    expect(ask('దీని ధర ఎంత')).toMatchObject({ intent: INTENT.PRICE, followUp: true, query: '' });
  });

  it('reads Telugu list questions with periods', () => {
    expect(ask('ఈ వారం ఏమి ఆర్డర్ చేయాలి')).toMatchObject({
      intent: INTENT.REORDER,
      periodDays: 7,
    });
    expect(ask('రెండు నెలలుగా అమ్ముడుపోలేదు ఏ పార్ట్స్')).toMatchObject({
      intent: INTENT.NON_MOVING,
      periodDays: 60,
    });
    expect(ask('ఏ పార్ట్స్ అయిపోయాయి').intent).toBe(INTENT.OUT_OF_STOCK);
    expect(ask('స్టాక్ తక్కువ ఉన్న పార్ట్స్').intent).toBe(INTENT.LOW_STOCK);
    expect(ask('ఈరోజు సేల్స్').intent).toBe(INTENT.TODAY);
    expect(ask('నమస్కారం').intent).toBe(INTENT.HELP);
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

describe('new question types', () => {
  it('reads sales, fast-moving, comparison, category and transfer questions', () => {
    expect(ask('How many were sold this month?')).toMatchObject({ intent: INTENT.SOLD, query: '' });
    expect(ask('hydraulic filter sold in last 60 days')).toMatchObject({
      intent: INTENT.SOLD,
      query: 'hydraulic filter',
      periodDays: 60,
    });
    expect(ask('fast moving parts').intent).toBe(INTENT.FAST_MOVING);
    expect(ask('Compare stock between Hyderabad and other branches.').intent).toBe(
      INTENT.BRANCH_COMPARE,
    );
    expect(ask('Which branch has the most stock?')).toMatchObject({
      intent: INTENT.WHERE_STOCK,
      query: '',
    });
    expect(ask('stock by category').intent).toBe(INTENT.CATEGORY);
    expect(ask('pending transfers').intent).toBe(INTENT.TRANSFERS);
  });

  it('tells stock received from stock sold today', () => {
    expect(ask("Show today's stock received.")).toMatchObject({
      intent: INTENT.TODAY,
      direction: 'in',
    });
    expect(ask("Show today's stock sales.")).toMatchObject({
      intent: INTENT.TODAY,
      direction: 'out',
    });
    expect(ask('today summary')).toMatchObject({ intent: INTENT.TODAY, direction: null });
    expect(ask('आज कितने पार्ट्स आए हैं?')).toMatchObject({
      intent: INTENT.TODAY,
      direction: 'in',
    });
    expect(ask('आज कितने पार्ट्स बिके?')).toMatchObject({ intent: INTENT.TODAY, direction: 'out' });
    expect(ask('ఈరోజు ఎన్ని పార్ట్స్ వచ్చాయి?')).toMatchObject({
      intent: INTENT.TODAY,
      direction: 'in',
    });
    expect(ask('ఈరోజు ఎన్ని పార్ట్స్ అమ్ముడయ్యాయి?')).toMatchObject({
      intent: INTENT.TODAY,
      direction: 'out',
    });
  });

  it('reads the same questions in Hindi and Telugu', () => {
    expect(ask('कौन-कौन से आइटम दोबारा मंगाने हैं?').intent).toBe(INTENT.REORDER);
    expect(ask('ఏ వస్తువులను మళ్లీ ఆర్డర్ చేయాలి?').intent).toBe(INTENT.REORDER);
    expect(ask('पिछले 60 दिनों से कौन से आइटम नहीं बिके हैं?')).toMatchObject({
      intent: INTENT.NON_MOVING,
      periodDays: 60,
    });
    expect(ask('గత 60 రోజులుగా కదలని స్టాక్ ఏది?')).toMatchObject({
      intent: INTENT.NON_MOVING,
      periodDays: 60,
    });
    expect(ask('हैदराबाद और दूसरी ब्रांच के स्टॉक की तुलना करो।').intent).toBe(
      INTENT.BRANCH_COMPARE,
    );
    expect(ask('హైదరాబాద్ మరియు ఇతర బ్రాంచ్‌ల స్టాక్‌ను పోల్చండి.').intent).toBe(
      INTENT.BRANCH_COMPARE,
    );
    expect(ask('PC200 idler ka stock kitna hai?')).toMatchObject({
      intent: INTENT.STOCK_CHECK,
      query: 'pc200 idler',
    });
  });

  it('recognises branch names said in Hindi and Telugu', () => {
    expect(ask('हैदराबाद ब्रांच में PC200 आइडलर कितने स्टॉक में हैं?')).toMatchObject({
      intent: INTENT.STOCK_CHECK,
      query: 'pc200 idler',
      branchId: 1,
    });
    expect(ask('హైదరాబాద్ బ్రాంచ్‌లో PC200 ఐడ్లర్లు ఎన్ని స్టాక్‌లో ఉన్నాయి?')).toMatchObject({
      intent: INTENT.STOCK_CHECK,
      query: 'pc200 idler',
      branchId: 1,
    });
    expect(ask('విజయవాడలో ఎంత ఉంది')).toMatchObject({ branchId: 2, followUp: true, query: '' });
    expect(ask('विजयवाड़ा में कितना है')).toMatchObject({ branchId: 2, followUp: true, query: '' });
  });
});

describe('answer catalogue', () => {
  it('has every message in every language', () => {
    const keys = Object.keys(MESSAGES.en).sort();
    for (const language of LANGUAGES) {
      expect(Object.keys(MESSAGES[language]).sort()).toEqual(keys);
    }
  });

  // Suggested questions are tapped and sent back, so each must be understood.
  it.each(LANGUAGES)('suggests questions it understands itself (%s)', (language) => {
    const m = MESSAGES[language];
    const name = 'Hydraulic Filter';
    expect(ask(m.sReorder()).intent).toBe(INTENT.REORDER);
    expect(ask(m.sNonMoving())).toMatchObject({ intent: INTENT.NON_MOVING, periodDays: 60 });
    expect(ask(m.sOut()).intent).toBe(INTENT.OUT_OF_STOCK);
    expect(ask(m.sLow()).intent).toBe(INTENT.LOW_STOCK);
    expect(ask(m.sToday()).intent).toBe(INTENT.TODAY);
    expect(ask(m.sCompare()).intent).toBe(INTENT.BRANCH_COMPARE);
    expect(ask(m.sTop()).intent).toBe(INTENT.FAST_MOVING);
    expect(ask(m.sSold())).toMatchObject({ intent: INTENT.SOLD, query: '' });
    expect(ask(m.sExample())).toMatchObject({
      intent: INTENT.STOCK_CHECK,
      query: 'hydraulic filter',
    });
    expect(ask(m.sPrice({ name }))).toMatchObject({
      intent: INTENT.PRICE,
      query: 'hydraulic filter',
    });
    expect(ask(m.sWhere({ name }))).toMatchObject({
      intent: INTENT.WHERE_STOCK,
      query: 'hydraulic filter',
    });
    expect(ask(m.sStock({ name }))).toMatchObject({
      intent: INTENT.STOCK_CHECK,
      query: 'hydraulic filter',
    });
  });
});
