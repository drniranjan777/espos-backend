import Decimal from 'decimal.js';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import * as askStockRepository from '../../repositories/askStockRepository.js';
import * as dashboardRepository from '../../repositories/dashboardRepository.js';
import * as productRepository from '../../repositories/productRepository.js';
import { todayIso } from '../../utils/date.js';
import { getSummary } from '../dashboardService.js';
import { quickSearch } from '../productService.js';
import { DEFAULT_LANGUAGE, LANGUAGES, translator } from './messages.js';
import { INTENT, parseQuestion } from './parseQuestion.js';

/**
 * Ask Stock: answers stock questions from the database with fixed, read-only queries.
 * It never changes data. Every answer is limited by the user's permissions and branches,
 * and is written from templates in the user's language (see messages.js) — figures always
 * come from the database, never from free text generation.
 *
 * Reply shape: { reply, cards, suggestions, context, language }
 *   cards: { type: 'part', part } | { type: 'parts', title, parts } | { type: 'table', title, columns, rows }
 *   context: { productId, productName } — the part discussed, for follow-up questions.
 */

const LIST_LIMIT = 10;
const DEFAULT_NON_MOVING_DAYS = 60;
const DEFAULT_PERIOD_DAYS = 30;
// Reorder: usage over the last 30 days, look 7 days ahead, order enough for 14 days.
const REORDER_USAGE_DAYS = 30;
const REORDER_HORIZON_DAYS = 7;
const REORDER_COVER_DAYS = 14;

const TRANSFER_PERMISSIONS = [P.TRANSFER_REQUEST, P.TRANSFER_APPROVE, P.TRANSFER_RECEIVE];

const can = (user, ...codes) => codes.some((code) => user.permissions.includes(code));
const fmt = (value) => new Decimal(value ?? 0).toDecimalPlaces(3).toString();
const money = (value) => new Decimal(value ?? 0).toFixed(2);

function daysAgoIso(days) {
  const date = new Date(`${todayIso()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function stockStatus(part) {
  const qty = Number(part.stockQuantity);
  if (qty <= 0) return 'out';
  if (qty <= Number(part.minStockLevel)) return 'low';
  return 'ok';
}

/** Purchase price is shown only to users who may see costs (reports). */
function publicPart(part, user) {
  const { purchasePrice, unitAllowDecimal: _unitAllowDecimal, ...rest } = part;
  return {
    ...rest,
    status: stockStatus(part),
    ...(can(user, P.REPORTS_VIEW) ? { purchasePrice } : {}),
  };
}

function reply(text, extra = {}) {
  return { reply: text, cards: [], suggestions: [], context: null, ...extra };
}

const column = (key, label, align) => ({ key, label, ...(align ? { align } : {}) });

/** Everything an answer needs: who asks, where, in which language, and what was asked. */
function buildRequest(message, context, user, branch, language) {
  const t = translator(language);
  return {
    t,
    user,
    context,
    parsed: parseQuestion(message, { branches: user.branches }),
    warehouseId: branch.id,
    branchName: branch.name,
    denied: () => reply(t('denied')),
    general: () => [t('sReorder'), t('sNonMoving'), t('sOut')],
    aboutPart: (name) => [t('sPrice', { name }), t('sWhere', { name }), t('sSold')],
  };
}

/** Finds the part a question is about: by the search words, else the part discussed last. */
async function findParts({ parsed, context, warehouseId }) {
  if (parsed.query) return quickSearch(parsed.query, warehouseId);
  if (context?.productId) {
    const part = await productRepository.findById(context.productId, warehouseId);
    return part ? [{ ...part, matchType: 'exact' }] : [];
  }
  return [];
}

async function partCard(part, user, warehouseId) {
  const branchIds = user.branches.map((b) => b.id);
  const branches = await askStockRepository.stockAcrossBranches(part.id, branchIds);
  return {
    type: 'part',
    part: {
      ...publicPart(part, user),
      branches: branches.map((b) => ({ ...b, isCurrent: b.branchId === warehouseId })),
    },
  };
}

/** When several parts match, the user picks one instead of getting a possibly wrong figure. */
function choosePart(req, parts, suggest) {
  const { t, parsed, user, branchName } = req;
  const similar = parts[0].matchType === 'similar';
  return reply(
    similar
      ? t('closestParts', { query: parsed.query, branch: branchName })
      : t('manyParts', { count: parts.length, query: parsed.query, branch: branchName }),
    {
      cards: [
        {
          type: 'parts',
          title: t('stockInBranchTitle', { branch: branchName }),
          parts: parts.slice(0, LIST_LIMIT).map((p) => publicPart(p, user)),
        },
      ],
      suggestions: parts.slice(0, 4).map((p) => suggest(p.name)),
    },
  );
}

async function answerAboutPart(req) {
  const { t, parsed, user, warehouseId, branchName } = req;
  if (!can(user, P.PRODUCTS_VIEW, P.INVENTORY_VIEW)) return req.denied();
  const parts = await findParts(req);

  if (!parts.length) {
    // "Which branch has the most stock?" with no part in mind compares the branches.
    if (!parsed.query && parsed.intent === INTENT.WHERE_STOCK) return answerCompare(req);
    // Maybe it was a customer name rather than a part.
    if (parsed.query && can(user, P.CUSTOMERS_VIEW, P.CUSTOMERS_MANAGE, P.INVOICE_VIEW)) {
      const customers = await askStockRepository.customersMentioned(parsed.query, 1);
      if (customers.length) return answerCustomer(req, customers[0]);
    }
    return reply(parsed.query ? t('partNotFound', { query: parsed.query }) : t('whichPart'), {
      suggestions: req.general(),
    });
  }

  if (parts.length > 1) {
    return choosePart(req, parts, (name) =>
      parsed.intent === INTENT.PRICE ? t('sPrice', { name }) : t('sStock', { name }),
    );
  }

  // Full details (incl. purchase price, which search results leave out).
  const part = await productRepository.findById(parts[0].id, warehouseId);
  const card = await partCard(part, user, warehouseId);
  const context = { productId: part.id, productName: part.name };
  const unit = part.unitCode;
  const { name, sku } = part;
  const branches = card.part.branches;
  const prefix = parts[0].matchType === 'similar' ? t('closestPrefix', { name }) : '';
  const extra = { cards: [card], context, suggestions: req.aboutPart(name) };

  if (parsed.intent === INTENT.PRICE) {
    const cost = can(user, P.REPORTS_VIEW)
      ? t('purchasePrice', { price: fmt(part.purchasePrice) })
      : '';
    const text = t('price', {
      name,
      sku,
      unit,
      price: fmt(part.sellingPrice),
      mrp: fmt(part.mrp),
    });
    return reply(`${prefix}${text}${cost}`, {
      ...extra,
      suggestions: [t('sStock', { name }), t('sWhere', { name })],
    });
  }

  if (parsed.intent === INTENT.WHERE_STOCK) {
    const withStock = branches.filter((b) => Number(b.quantity) > 0);
    if (!withStock.length) return reply(`${prefix}${t('whereNone', { name })}`, extra);
    const list = withStock.map((b) => `${b.branchName} (${fmt(b.quantity)} ${unit})`).join(', ');
    const top = withStock.reduce((a, b) => (Number(b.quantity) > Number(a.quantity) ? b : a));
    const most =
      withStock.length > 1
        ? t('whereMost', { branch: top.branchName, qty: fmt(top.quantity), unit })
        : '';
    return reply(`${prefix}${t('whereInStock', { name, list })}${most}`, extra);
  }

  if (parsed.branchId) {
    const asked = branches.find((b) => b.branchId === parsed.branchId);
    if (!asked) return reply(t('branchDenied'), { cards: [card], context });
    return reply(
      `${prefix}${t('stockAtBranch', { name, unit, qty: fmt(asked.quantity), branch: asked.branchName })}`,
      extra,
    );
  }

  const here = branches.find((b) => b.isCurrent);
  const status = stockStatus(part);
  const note =
    status === 'out'
      ? t('noteOut')
      : status === 'low'
        ? t('noteLow', { min: fmt(part.minStockLevel) })
        : '';
  const text = t('stockHere', {
    name,
    sku,
    unit,
    qty: fmt(here?.quantity ?? part.stockQuantity),
    branch: branchName,
  });
  return reply(`${prefix}${text}${note}`, extra);
}

async function answerReorder(req) {
  const { t, user, warehouseId, branchName } = req;
  if (!can(user, P.INVENTORY_VIEW)) return req.denied();
  const rows = await askStockRepository.reorderCandidates(warehouseId, {
    usageDays: REORDER_USAGE_DAYS,
    horizonDays: REORDER_HORIZON_DAYS,
    limit: LIST_LIMIT,
  });
  if (!rows.length) {
    return reply(t('reorderNone', { branch: branchName }), {
      suggestions: [t('sNonMoving'), t('sLow')],
    });
  }
  const tableRows = rows.map((r) => {
    const daily = new Decimal(r.usedInPeriod).div(REORDER_USAGE_DAYS);
    let suggested = daily.times(REORDER_COVER_DAYS).plus(r.minStockLevel).minus(r.stockQuantity);
    suggested = r.unitAllowDecimal
      ? suggested.toDecimalPlaces(1, Decimal.ROUND_UP)
      : suggested.ceil();
    if (suggested.lte(0)) suggested = new Decimal(1);
    return {
      productId: r.id,
      part: r.name,
      sku: r.sku,
      stock: `${fmt(r.stockQuantity)} ${r.unitCode}`,
      minimum: fmt(r.minStockLevel),
      used: fmt(r.usedInPeriod),
      order: `${suggested.toString()} ${r.unitCode}`,
    };
  });
  return reply(
    t('reorderSome', {
      count: rows.length,
      branch: branchName,
      horizon: REORDER_HORIZON_DAYS,
      cover: REORDER_COVER_DAYS,
    }),
    {
      cards: [
        {
          type: 'table',
          title: t('reorderTitle'),
          columns: [
            column('part', t('colPart')),
            column('stock', t('colStock'), 'right'),
            column('minimum', t('colMin'), 'right'),
            column('used', t('colUsed', { days: REORDER_USAGE_DAYS }), 'right'),
            column('order', t('colOrder'), 'right'),
          ],
          rows: tableRows,
        },
      ],
      suggestions: [t('sNonMoving'), t('sOut')],
    },
  );
}

async function answerNonMoving(req) {
  const { t, parsed, user, warehouseId, branchName } = req;
  if (!can(user, P.INVENTORY_VIEW)) return req.denied();
  const days = parsed.periodDays ?? DEFAULT_NON_MOVING_DAYS;
  const rows = await askStockRepository.nonMovingParts(warehouseId, { days, limit: LIST_LIMIT });
  if (!rows.length) {
    return reply(t('nonMovingNone', { branch: branchName, days }), {
      suggestions: [t('sReorder'), t('sTop')],
    });
  }
  const showValue = can(user, P.REPORTS_VIEW);
  return reply(
    t('nonMovingSome', { count: rows.length, branch: branchName, days, byValue: showValue }),
    {
      cards: [
        {
          type: 'table',
          title: t('nonMovingTitle', { days }),
          columns: [
            column('part', t('colPart')),
            column('stock', t('colStock'), 'right'),
            column('lastOut', t('colLastOut')),
            ...(showValue ? [column('value', t('colValue'), 'right')] : []),
          ],
          rows: rows.map((r) => ({
            productId: r.id,
            part: r.name,
            sku: r.sku,
            stock: `${fmt(r.stockQuantity)} ${r.unitCode}`,
            lastOut: r.lastOutDate ?? t('never'),
            ...(showValue
              ? { value: `₹${money(new Decimal(r.stockQuantity).times(r.purchasePrice))}` }
              : {}),
          })),
        },
      ],
      suggestions: [t('sReorder'), t('sTop')],
    },
  );
}

async function answerList(req, kind) {
  const { t, user, warehouseId, branchName } = req;
  if (!can(user, P.PRODUCTS_VIEW, P.INVENTORY_VIEW)) return req.denied();
  const rows =
    kind === 'out'
      ? await askStockRepository.outOfStockParts(warehouseId, LIST_LIMIT)
      : await askStockRepository.lowStockParts(warehouseId, LIST_LIMIT);
  if (!rows.length) return reply(t(`${kind}None`, { branch: branchName }));
  const count = `${rows.length}${rows.length === LIST_LIMIT ? '+' : ''}`;
  return reply(t(`${kind}Some`, { count, branch: branchName }), {
    cards: [
      { type: 'parts', title: t(`${kind}Title`), parts: rows.map((r) => publicPart(r, user)) },
    ],
    suggestions: [t('sReorder')],
  });
}

async function answerMachine(req) {
  const { t, parsed, user, warehouseId, branchName } = req;
  if (!can(user, P.PRODUCTS_VIEW, P.INVENTORY_VIEW)) return req.denied();
  if (!parsed.query) return reply(t('whichMachine'));
  const rows = await askStockRepository.partsForMachine(warehouseId, parsed.query, LIST_LIMIT);
  if (!rows.length) return reply(t('machineNone', { model: parsed.query }));
  const model = parsed.query.toUpperCase();
  return reply(t('machineSome', { model, branch: branchName }), {
    cards: [
      {
        type: 'parts',
        title: t('machineTitle', { model }),
        parts: rows.map((r) => publicPart(r, user)),
      },
    ],
  });
}

async function answerCustomer(req, knownCustomer) {
  const { t, parsed, user, warehouseId } = req;
  if (!can(user, P.CUSTOMERS_VIEW, P.CUSTOMERS_MANAGE, P.INVOICE_VIEW)) return req.denied();
  const customer =
    knownCustomer ?? (await askStockRepository.customersMentioned(parsed.query || '', 1))[0];
  if (!customer) return reply(t('whichCustomer'));

  const days = parsed.periodDays ?? DEFAULT_PERIOD_DAYS;
  const activity = await askStockRepository.customerActivity(
    customer.id,
    warehouseId,
    daysAgoIso(days),
  );
  const name = customer.companyName || customer.name;
  const invoices = can(user, P.INVOICE_VIEW)
    ? t('invoices', { count: activity.invoiceCount, total: money(activity.invoiceTotal) })
    : '';
  if (!activity.items.length) return reply(`${t('customerNone', { name, days })}${invoices}`);
  return reply(`${t('customerSome', { name, days, count: activity.items.length })}${invoices}`, {
    cards: [
      {
        type: 'table',
        title: t('customerTitle', { name, days }),
        columns: [
          column('part', t('colPart')),
          column('quantity', t('colQty'), 'right'),
          column('lastDate', t('colLast')),
        ],
        rows: activity.items.map((i) => ({
          productId: i.id,
          part: i.name,
          sku: i.sku,
          quantity: `${fmt(i.quantity)} ${i.unitCode}`,
          lastDate: i.lastDate,
        })),
      },
    ],
  });
}

function movementTable(t, title, rows) {
  return {
    type: 'table',
    title,
    columns: [
      column('part', t('colPart')),
      column('quantity', t('colQty'), 'right'),
      column('entries', t('colEntries'), 'right'),
    ],
    rows: rows.map((r) => ({
      productId: r.id,
      part: r.name,
      sku: r.sku,
      quantity: `${fmt(r.quantity ?? r.quantityOut)} ${r.unitCode}`,
      entries: String(r.entries ?? r.movements),
    })),
  };
}

/** Today's figures; with a direction ("received" / "sold") the parts that moved are listed. */
async function answerToday(req) {
  const { t, parsed, user, warehouseId, branchName } = req;
  if (!can(user, P.DASHBOARD_VIEW)) return req.denied();
  const s = await getSummary(user, warehouseId);
  const suggestions = [t('sOut'), t('sReorder')];

  if (parsed.direction && can(user, P.INVENTORY_VIEW)) {
    const incoming = parsed.direction === 'in';
    const rows = await askStockRepository.movementsOn(
      warehouseId,
      todayIso(),
      parsed.direction,
      LIST_LIMIT,
    );
    const text = t(incoming ? 'todayIn' : 'todayOut', {
      branch: branchName,
      qty: fmt(incoming ? s.today.stockIn : s.today.stockOut),
      count: incoming ? s.today.inCount : s.today.outCount,
    });
    const sales =
      !incoming && 'salesValue' in s.today
        ? t('todaySales', { count: s.today.invoiceCount, value: money(s.today.salesValue) })
        : '';
    return reply(`${text}${sales}`, {
      cards: rows.length
        ? [movementTable(t, t(incoming ? 'todayInTitle' : 'todayOutTitle'), rows)]
        : [],
      suggestions,
    });
  }

  const text = t('today', {
    branch: branchName,
    out: fmt(s.today.stockOut),
    outCount: s.today.outCount,
    in: fmt(s.today.stockIn),
    inCount: s.today.inCount,
  });
  const sales =
    'salesValue' in s.today
      ? t('todaySales', { count: s.today.invoiceCount, value: money(s.today.salesValue) })
      : '';
  const levels = t('todayLevels', { low: s.lowStockCount, out: s.outOfStockCount });
  return reply(`${text}${sales}${levels}`, { suggestions });
}

/** Fastest-moving parts of the branch in a period (by quantity that went out). */
async function answerTopMovers(req) {
  const { t, parsed, user, warehouseId, branchName } = req;
  if (!can(user, P.INVENTORY_VIEW)) return req.denied();
  const days = parsed.periodDays ?? DEFAULT_PERIOD_DAYS;
  const rows = await dashboardRepository.topMovingProducts(
    warehouseId,
    daysAgoIso(days),
    LIST_LIMIT,
  );
  if (!rows.length) return reply(t('topNone', { days, branch: branchName }));
  return reply(t('topSome', { days, branch: branchName }), {
    cards: [movementTable(t, t('topTitle', { days }), rows)],
    suggestions: [t('sNonMoving'), t('sReorder')],
  });
}

/** "How many were sold this month?" for a part; without a part, the top movers. */
async function answerSold(req) {
  const { t, parsed, user, warehouseId, branchName } = req;
  if (!can(user, P.INVENTORY_VIEW)) return req.denied();
  const parts = await findParts(req);
  if (!parts.length) {
    return parsed.query
      ? reply(t('partNotFound', { query: parsed.query }), { suggestions: req.general() })
      : answerTopMovers(req);
  }
  if (parts.length > 1) return choosePart(req, parts, (name) => t('sStock', { name }));

  const part = parts[0];
  const days = parsed.periodDays ?? DEFAULT_PERIOD_DAYS;
  const sold = await askStockRepository.partOutbound(part.id, warehouseId, daysAgoIso(days));
  const extra = {
    context: { productId: part.id, productName: part.name },
    suggestions: [t('sStock', { name: part.name }), t('sWhere', { name: part.name })],
  };
  if (!sold.entries) {
    return reply(t('soldNonePart', { name: part.name, days, branch: branchName }), extra);
  }
  return reply(
    t('soldPart', {
      name: part.name,
      qty: fmt(sold.quantity),
      unit: part.unitCode,
      days,
      branch: branchName,
      entries: sold.entries,
    }),
    extra,
  );
}

/** Stock totals side by side for every branch the user may see. */
async function answerCompare(req) {
  const { t, user, warehouseId } = req;
  if (!can(user, P.INVENTORY_VIEW)) return req.denied();
  const rows = await askStockRepository.branchTotals(user.branches.map((b) => b.id));
  const showValue = can(user, P.REPORTS_VIEW);
  return reply(t('compare', { count: rows.length }), {
    cards: [
      {
        type: 'table',
        title: t('compareTitle'),
        columns: [
          column('branch', t('colBranch')),
          column('parts', t('colParts'), 'right'),
          column('units', t('colUnits'), 'right'),
          column('low', t('colLow'), 'right'),
          column('out', t('colOut'), 'right'),
          ...(showValue ? [column('value', t('colValue'), 'right')] : []),
        ],
        rows: rows.map((r) => ({
          key: `branch-${r.branchId}`,
          highlight: r.branchId === warehouseId,
          branch: r.branchName,
          parts: String(r.partsInStock),
          units: fmt(r.totalQuantity),
          low: String(r.lowCount),
          out: String(r.outCount),
          ...(showValue ? { value: `₹${money(r.stockValue)}` } : {}),
        })),
      },
    ],
    suggestions: [t('sLow'), t('sReorder')],
  });
}

async function answerCategory(req) {
  const { t, user, warehouseId, branchName } = req;
  if (!can(user, P.INVENTORY_VIEW)) return req.denied();
  const rows = await askStockRepository.stockByCategory(warehouseId);
  const showValue = can(user, P.REPORTS_VIEW);
  return reply(t('categoryIntro', { branch: branchName }), {
    cards: [
      {
        type: 'table',
        title: t('categoryTitle'),
        columns: [
          column('category', t('colCategory')),
          column('parts', t('colParts'), 'right'),
          column('units', t('colUnits'), 'right'),
          ...(showValue ? [column('value', t('colValue'), 'right')] : []),
        ],
        rows: rows.map((r) => ({
          key: `category-${r.categoryId ?? 0}`,
          category: r.categoryName ?? t('uncategorised'),
          parts: String(r.partCount),
          units: fmt(r.totalQuantity),
          ...(showValue ? { value: `₹${money(r.stockValue)}` } : {}),
        })),
      },
    ],
  });
}

async function answerTransfers(req) {
  const { t, user, warehouseId, branchName } = req;
  if (!can(user, ...TRANSFER_PERMISSIONS)) return req.denied();
  const counts = await dashboardRepository.transferCounts(warehouseId);
  return reply(
    t('transfers', {
      branch: branchName,
      awaiting: counts.awaitingApproval,
      incoming: counts.incoming,
    }),
  );
}

const HANDLERS = {
  [INTENT.HELP]: (req) =>
    reply(req.t('help'), { suggestions: [req.t('sExample'), ...req.general()] }),
  [INTENT.REORDER]: answerReorder,
  [INTENT.NON_MOVING]: answerNonMoving,
  [INTENT.FAST_MOVING]: answerTopMovers,
  [INTENT.SOLD]: answerSold,
  [INTENT.OUT_OF_STOCK]: (req) => answerList(req, 'out'),
  [INTENT.LOW_STOCK]: (req) => answerList(req, 'low'),
  [INTENT.MACHINE_PARTS]: answerMachine,
  [INTENT.CUSTOMER]: (req) => answerCustomer(req),
  [INTENT.TODAY]: answerToday,
  [INTENT.BRANCH_COMPARE]: answerCompare,
  [INTENT.CATEGORY]: answerCategory,
  [INTENT.TRANSFERS]: answerTransfers,
  [INTENT.STOCK_CHECK]: answerAboutPart,
  [INTENT.WHERE_STOCK]: answerAboutPart,
  [INTENT.PRICE]: answerAboutPart,
};

/**
 * @param {string} message
 * @param {{ productId?: number }|null} context  part discussed in the previous answer
 * @param {object} user        authenticated user (permissions, branches)
 * @param {{ id: number, name: string }} branch  current branch
 * @param {string} [language]  'en' | 'hi' | 'te' — language of the answer
 */
export async function answer(message, context, user, branch, language = DEFAULT_LANGUAGE) {
  const req = buildRequest(message, context, user, branch, language);
  const handler = HANDLERS[req.parsed.intent];
  const result = handler
    ? await handler(req)
    : reply(req.t('unknown'), { suggestions: req.general() });
  return { ...result, language };
}

/** Starter questions in the user's language, limited to what they are allowed to ask. */
export function suggestions(user, language = DEFAULT_LANGUAGE) {
  const t = translator(language);
  const list = [];
  if (can(user, P.PRODUCTS_VIEW, P.INVENTORY_VIEW)) list.push(t('sExample'));
  if (can(user, P.INVENTORY_VIEW)) list.push(t('sReorder'), t('sNonMoving'));
  if (can(user, P.DASHBOARD_VIEW)) list.push(t('sToday'));
  if (can(user, P.INVENTORY_VIEW) && user.branches.length > 1) list.push(t('sCompare'));
  return list.slice(0, 5);
}

/** `language` is null until the user picks one (the app then uses the device's last choice). */
export async function getPreferences(userId) {
  const stored = await askStockRepository.getVoiceLanguage(userId);
  return { language: LANGUAGES.includes(stored) ? stored : null };
}

export async function savePreferences(userId, { language }) {
  await askStockRepository.setVoiceLanguage(userId, language);
  return { language };
}
