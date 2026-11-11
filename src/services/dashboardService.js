import { PERMISSIONS } from '../constants/permissions.js';
import * as dashboardRepository from '../repositories/dashboardRepository.js';
import { canViewPurchasePrice } from '../utils/access.js';
import { todayIso } from '../utils/date.js';

const TOP_PRODUCTS_DAYS = 30;
const LIST_LIMIT = 10;

function daysAgoIso(today, days) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Dashboard KPIs for the current user. Sales figures are only included for users
 * who can view invoices; stock value (priced at purchase price) only for Admin.
 */
export async function getSummary(user, warehouseId) {
  const today = todayIso();
  const canSeeSales = user.permissions.includes(PERMISSIONS.INVOICE_VIEW);
  const canSeeValue = canViewPurchasePrice(user);

  const [stock, movement, sales, lowStock, topProducts, transfers] = await Promise.all([
    dashboardRepository.stockSummary(warehouseId),
    dashboardRepository.movementOn(warehouseId, today),
    canSeeSales ? dashboardRepository.salesOn(warehouseId, today) : null,
    dashboardRepository.lowStockProducts(warehouseId, LIST_LIMIT),
    dashboardRepository.topMovingProducts(warehouseId, daysAgoIso(today, TOP_PRODUCTS_DAYS), 5),
    dashboardRepository.transferCounts(warehouseId),
  ]);

  const { stockValue, ...stockCounts } = stock;
  return {
    date: today,
    ...stockCounts,
    ...(canSeeValue ? { stockValue } : {}),
    today: {
      stockIn: movement.stockIn,
      stockOut: movement.stockOut,
      inCount: movement.inCount,
      outCount: movement.outCount,
      ...(sales ? { invoiceCount: sales.invoiceCount, salesValue: sales.salesValue } : {}),
    },
    lowStock,
    topProducts,
    // Transfers needing attention in this branch: requests awaiting approval (outgoing)
    // and stock on its way here (incoming).
    transfers,
    topProductsDays: TOP_PRODUCTS_DAYS,
  };
}

export async function getMovement(range, warehouseId) {
  return dashboardRepository.movementSeries(warehouseId, range, todayIso());
}

/** Purchase price and purchase value columns are Admin-only; selling value stays for report users. */
export async function stockValuationReport(filters, warehouseId, user) {
  const showCost = canViewPurchasePrice(user);
  const all = await dashboardRepository.stockValuation(warehouseId, filters);
  const rows = showCost
    ? all
    : all.map(({ purchasePrice: _price, purchaseValue: _value, ...rest }) => rest);
  const totals = rows.reduce(
    (acc, r) => ({
      purchaseValue: acc.purchaseValue + Number(r.purchaseValue),
      sellingValue: acc.sellingValue + Number(r.sellingValue),
    }),
    { purchaseValue: 0, sellingValue: 0 },
  );
  return {
    rows,
    totals: {
      ...(showCost ? { purchaseValue: Math.round(totals.purchaseValue * 100) / 100 } : {}),
      sellingValue: Math.round(totals.sellingValue * 100) / 100,
    },
  };
}

export async function movementReport(filters, warehouseId) {
  return dashboardRepository.movementReport(warehouseId, filters);
}
