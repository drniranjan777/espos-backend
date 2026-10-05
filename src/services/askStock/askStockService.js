import Decimal from 'decimal.js';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import * as askStockRepository from '../../repositories/askStockRepository.js';
import * as productRepository from '../../repositories/productRepository.js';
import { todayIso } from '../../utils/date.js';
import { getSummary } from '../dashboardService.js';
import { quickSearch } from '../productService.js';
import { INTENT, parseQuestion } from './parseQuestion.js';

/**
 * Ask Stock: answers stock questions from the database with fixed, read-only queries.
 * It never changes data. Every answer is limited by the user's permissions and branches.
 *
 * Reply shape: { reply, cards, suggestions, context }
 *   cards: { type: 'part', part } | { type: 'parts', title, parts } | { type: 'table', title, columns, rows }
 *   context: { productId, productName } — the part discussed, for follow-up questions.
 */

const LIST_LIMIT = 10;
const DEFAULT_NON_MOVING_DAYS = 60;
const DEFAULT_CUSTOMER_DAYS = 30;
// Reorder: usage over the last 30 days, look 7 days ahead, order enough for 14 days.
const REORDER_USAGE_DAYS = 30;
const REORDER_HORIZON_DAYS = 7;
const REORDER_COVER_DAYS = 14;

const SUGGESTIONS = {
  stock: (name) => [`Price of ${name}?`, `Which branch has ${name}?`],
  general: [
    'What should I reorder this week?',
    'Which parts have not moved in two months?',
    'What is out of stock?',
  ],
};

const can = (user, ...codes) => codes.some((code) => user.permissions.includes(code));
const fmt = (value) => new Decimal(value ?? 0).toDecimalPlaces(3).toString();

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

function denied() {
  return reply('You don’t have access to that information. Ask an administrator if you need it.');
}

/** Finds the part a question is about: by the search words, else the part discussed last. */
async function findParts(parsed, context, warehouseId) {
  if (parsed.query) return quickSearch(parsed.query, warehouseId);
  if (context?.productId) {
    const part = await productRepository.findById(context.productId, warehouseId);
    return part ? [{ ...part, matchType: 'exact' }] : [];
  }
  return [];
}

function choiceSuggestions(parts, phrasing) {
  return parts.slice(0, 4).map((p) => phrasing(p.name));
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

async function answerAboutPart(parsed, context, user, warehouseId, branchName) {
  if (!can(user, P.PRODUCTS_VIEW, P.INVENTORY_VIEW)) return denied();
  const parts = await findParts(parsed, context, warehouseId);

  if (!parts.length) {
    // Maybe it was a customer name rather than a part.
    if (parsed.query && can(user, P.CUSTOMERS_VIEW, P.CUSTOMERS_MANAGE, P.INVOICE_VIEW)) {
      const customers = await askStockRepository.customersMentioned(parsed.query, 1);
      if (customers.length) return answerCustomer(parsed, user, warehouseId, customers[0]);
    }
    return reply(
      parsed.query
        ? `I couldn’t find a part matching “${parsed.query}”. Try the part number, or a shorter name like “hydraulic filter”.`
        : 'Which part do you mean? Say its name or part number, e.g. “PC200 idler stock”.',
      { suggestions: SUGGESTIONS.general },
    );
  }

  const similar = parts[0].matchType === 'similar';
  if (parts.length > 1) {
    return reply(
      similar
        ? `No exact match for “${parsed.query}”. These are the closest parts in ${branchName}:`
        : `I found ${parts.length} parts matching “${parsed.query}” in ${branchName}. Which one?`,
      {
        cards: [
          {
            type: 'parts',
            title: `Stock in ${branchName}`,
            parts: parts.slice(0, LIST_LIMIT).map((p) => publicPart(p, user)),
          },
        ],
        suggestions: choiceSuggestions(parts, (name) =>
          parsed.intent === INTENT.PRICE ? `Price of ${name}?` : `${name} stock`,
        ),
      },
    );
  }

  // Full details (incl. purchase price, which search results leave out).
  const part = await productRepository.findById(parts[0].id, warehouseId);
  const card = await partCard(part, user, warehouseId);
  const context2 = { productId: part.id, productName: part.name };
  const unit = part.unitCode;
  const here = card.part.branches.find((b) => b.isCurrent);
  const asked = parsed.branchId
    ? card.part.branches.find((b) => b.branchId === parsed.branchId)
    : null;
  const prefix = similar ? `Closest match: ${part.name}. ` : '';

  if (parsed.intent === INTENT.PRICE) {
    const cost = can(user, P.REPORTS_VIEW) ? ` Purchase price ₹${fmt(part.purchasePrice)}.` : '';
    return reply(
      `${prefix}${part.name} (${part.sku}) sells at ₹${fmt(part.sellingPrice)} per ${unit}, MRP ₹${fmt(part.mrp)}.${cost}`,
      {
        cards: [card],
        context: context2,
        suggestions: [`${part.name} stock`, `Which branch has ${part.name}?`],
      },
    );
  }

  if (parsed.intent === INTENT.WHERE_STOCK) {
    const withStock = card.part.branches.filter((b) => Number(b.quantity) > 0);
    const text = withStock.length
      ? `${part.name} is in stock at ${withStock.map((b) => `${b.branchName} (${fmt(b.quantity)} ${unit})`).join(', ')}.`
      : `${part.name} is out of stock in every branch you can see.`;
    return reply(`${prefix}${text}`, {
      cards: [card],
      context: context2,
      suggestions: SUGGESTIONS.stock(part.name),
    });
  }

  if (asked) {
    return reply(`${prefix}${part.name}: ${fmt(asked.quantity)} ${unit} in ${asked.branchName}.`, {
      cards: [card],
      context: context2,
      suggestions: SUGGESTIONS.stock(part.name),
    });
  }
  if (parsed.branchId) {
    return reply('You don’t have access to that branch.', { cards: [card], context: context2 });
  }

  const status = stockStatus(part);
  const note =
    status === 'out'
      ? ' It is out of stock here.'
      : status === 'low'
        ? ` That is at or below the minimum level of ${fmt(part.minStockLevel)}.`
        : '';
  return reply(
    `${prefix}${part.name} (${part.sku}): ${fmt(here?.quantity ?? part.stockQuantity)} ${unit} in ${branchName}.${note}`,
    { cards: [card], context: context2, suggestions: SUGGESTIONS.stock(part.name) },
  );
}

async function answerReorder(user, warehouseId, branchName) {
  if (!can(user, P.INVENTORY_VIEW)) return denied();
  const rows = await askStockRepository.reorderCandidates(warehouseId, {
    usageDays: REORDER_USAGE_DAYS,
    horizonDays: REORDER_HORIZON_DAYS,
    limit: LIST_LIMIT,
  });
  if (!rows.length) {
    return reply(
      `Nothing needs reordering in ${branchName} this week: every part is expected to stay above its minimum level.`,
      { suggestions: ['Which parts have not moved in two months?', 'What is low on stock?'] },
    );
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
    `${rows.length} part${rows.length > 1 ? 's' : ''} in ${branchName} will reach the minimum level within ${REORDER_HORIZON_DAYS} days at the current usage. Suggested order covers ${REORDER_COVER_DAYS} days of usage above the minimum.`,
    {
      cards: [
        {
          type: 'table',
          title: 'Reorder this week',
          columns: [
            { key: 'part', label: 'Part' },
            { key: 'stock', label: 'Stock', align: 'right' },
            { key: 'minimum', label: 'Min', align: 'right' },
            { key: 'used', label: `Used ${REORDER_USAGE_DAYS}d`, align: 'right' },
            { key: 'order', label: 'Order', align: 'right' },
          ],
          rows: tableRows,
        },
      ],
      suggestions: ['Which parts have not moved in two months?', 'What is out of stock?'],
    },
  );
}

async function answerNonMoving(parsed, user, warehouseId, branchName) {
  if (!can(user, P.INVENTORY_VIEW)) return denied();
  const days = parsed.periodDays ?? DEFAULT_NON_MOVING_DAYS;
  const rows = await askStockRepository.nonMovingParts(warehouseId, { days, limit: LIST_LIMIT });
  if (!rows.length) {
    return reply(`No part in ${branchName} has gone ${days} days without moving.`, {
      suggestions: ['What should I reorder this week?'],
    });
  }
  const showValue = can(user, P.REPORTS_VIEW);
  const columns = [
    { key: 'part', label: 'Part' },
    { key: 'stock', label: 'Stock', align: 'right' },
    { key: 'lastOut', label: 'Last out' },
    ...(showValue ? [{ key: 'value', label: 'Value', align: 'right' }] : []),
  ];
  return reply(
    `${rows.length} part${rows.length > 1 ? 's' : ''} in ${branchName} have not gone out in the last ${days} days${showValue ? ' (largest stock value first)' : ''}.`,
    {
      cards: [
        {
          type: 'table',
          title: `Not moved in ${days} days`,
          columns,
          rows: rows.map((r) => ({
            productId: r.id,
            part: r.name,
            sku: r.sku,
            stock: `${fmt(r.stockQuantity)} ${r.unitCode}`,
            lastOut: r.lastOutDate ?? 'Never',
            ...(showValue
              ? { value: `₹${new Decimal(r.stockQuantity).times(r.purchasePrice).toFixed(2)}` }
              : {}),
          })),
        },
      ],
      suggestions: ['What should I reorder this week?'],
    },
  );
}

async function answerList(kind, user, warehouseId, branchName) {
  if (!can(user, P.PRODUCTS_VIEW, P.INVENTORY_VIEW)) return denied();
  const rows =
    kind === 'out'
      ? await askStockRepository.outOfStockParts(warehouseId, LIST_LIMIT)
      : await askStockRepository.lowStockParts(warehouseId, LIST_LIMIT);
  const label = kind === 'out' ? 'out of stock' : 'low on stock';
  if (!rows.length) return reply(`Nothing is ${label} in ${branchName}.`);
  return reply(
    `${rows.length}${rows.length === LIST_LIMIT ? '+' : ''} parts are ${label} in ${branchName}:`,
    {
      cards: [
        {
          type: 'parts',
          title: kind === 'out' ? 'Out of stock' : 'Low stock',
          parts: rows.map((r) => publicPart(r, user)),
        },
      ],
      suggestions: ['What should I reorder this week?'],
    },
  );
}

async function answerMachine(parsed, user, warehouseId, branchName) {
  if (!can(user, P.PRODUCTS_VIEW, P.INVENTORY_VIEW)) return denied();
  if (!parsed.query) return reply('Which machine? For example “parts for PC200” or “3DX parts”.');
  const rows = await askStockRepository.partsForMachine(warehouseId, parsed.query, LIST_LIMIT);
  if (!rows.length) {
    return reply(
      `No parts are listed for machine “${parsed.query}”. Try the model as written on the machine, e.g. “3DX” or “PC200”.`,
    );
  }
  return reply(`Parts for ${parsed.query.toUpperCase()} in ${branchName}:`, {
    cards: [
      {
        type: 'parts',
        title: `${parsed.query.toUpperCase()} parts`,
        parts: rows.map((r) => publicPart(r, user)),
      },
    ],
  });
}

async function answerCustomer(parsed, user, warehouseId, knownCustomer) {
  if (!can(user, P.CUSTOMERS_VIEW, P.CUSTOMERS_MANAGE, P.INVOICE_VIEW)) return denied();
  const customer =
    knownCustomer ?? (await askStockRepository.customersMentioned(parsed.query || '', 1))[0];
  if (!customer) {
    return reply(
      'Which customer? Say the customer or company name, e.g. “What did Patil Earthmovers buy this month?”.',
    );
  }
  const days = parsed.periodDays ?? DEFAULT_CUSTOMER_DAYS;
  const activity = await askStockRepository.customerActivity(
    customer.id,
    warehouseId,
    daysAgoIso(days),
  );
  const name = customer.companyName || customer.name;
  const invoiceText = can(user, P.INVOICE_VIEW)
    ? ` ${activity.invoiceCount} invoice${activity.invoiceCount === 1 ? '' : 's'} worth ₹${new Decimal(activity.invoiceTotal).toFixed(2)}.`
    : '';
  if (!activity.items.length) {
    return reply(`${name} took no parts from this branch in the last ${days} days.${invoiceText}`);
  }
  return reply(
    `In the last ${days} days ${name} took ${activity.items.length} different part${activity.items.length > 1 ? 's' : ''}.${invoiceText}`,
    {
      cards: [
        {
          type: 'table',
          title: `${name} — last ${days} days`,
          columns: [
            { key: 'part', label: 'Part' },
            { key: 'quantity', label: 'Qty', align: 'right' },
            { key: 'lastDate', label: 'Last' },
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
    },
  );
}

async function answerToday(user, warehouseId, branchName) {
  if (!can(user, P.DASHBOARD_VIEW)) return denied();
  const s = await getSummary(user, warehouseId);
  const sales =
    'salesValue' in s.today
      ? ` ${s.today.invoiceCount} invoice${s.today.invoiceCount === 1 ? '' : 's'}, sales ₹${new Decimal(s.today.salesValue).toFixed(2)}.`
      : '';
  return reply(
    `Today in ${branchName}: ${fmt(s.today.stockOut)} units out (${s.today.outCount} entries), ${fmt(s.today.stockIn)} units in (${s.today.inCount} entries).${sales} ${s.lowStockCount} parts are low and ${s.outOfStockCount} are out of stock.`,
    { suggestions: ['What is out of stock?', 'What should I reorder this week?'] },
  );
}

function help() {
  return reply(
    'I can tell you stock of any part (by name, part number or machine), which branch has it, prices, what to reorder, which parts are not moving, what is low or out of stock, what a customer bought, and today’s figures. You can type or tap the mic and speak in English or Hindi.',
    { suggestions: ['Hydraulic filter, how many in stock?', ...SUGGESTIONS.general] },
  );
}

/**
 * @param {string} message
 * @param {{ productId?: number }|null} context  part discussed in the previous answer
 * @param {object} user        authenticated user (permissions, branches)
 * @param {{ id: number, name: string }} branch  current branch
 */
export async function answer(message, context, user, branch) {
  const parsed = parseQuestion(message, { branches: user.branches });
  const warehouseId = branch.id;

  switch (parsed.intent) {
    case INTENT.HELP:
      return help();
    case INTENT.REORDER:
      return answerReorder(user, warehouseId, branch.name);
    case INTENT.NON_MOVING:
      return answerNonMoving(parsed, user, warehouseId, branch.name);
    case INTENT.OUT_OF_STOCK:
      return answerList('out', user, warehouseId, branch.name);
    case INTENT.LOW_STOCK:
      return answerList('low', user, warehouseId, branch.name);
    case INTENT.MACHINE_PARTS:
      return answerMachine(parsed, user, warehouseId, branch.name);
    case INTENT.CUSTOMER:
      return answerCustomer(parsed, user, warehouseId);
    case INTENT.TODAY:
      return answerToday(user, warehouseId, branch.name);
    case INTENT.STOCK_CHECK:
    case INTENT.WHERE_STOCK:
    case INTENT.PRICE:
      return answerAboutPart(parsed, context, user, warehouseId, branch.name);
    default:
      return reply(
        'Sorry, I didn’t understand that. Ask about a part’s stock or price, reorders, slow-moving parts, a customer or today’s figures.',
        { suggestions: SUGGESTIONS.general },
      );
  }
}
