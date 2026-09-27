import { PERMISSIONS } from '../constants/permissions.js';
import * as dashboardRepository from '../repositories/dashboardRepository.js';
import { getDefaultWarehouseId } from '../repositories/warehouseRepository.js';
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
 * who can view invoices; stock value only for users who can see reports.
 */
export async function getSummary(user) {
  const warehouseId = await getDefaultWarehouseId();
  const today = todayIso();
  const canSeeSales = user.permissions.includes(PERMISSIONS.INVOICE_VIEW);
  const canSeeValue = user.permissions.includes(PERMISSIONS.REPORTS_VIEW);

  const [stock, movement, sales, lowStock, topProducts] = await Promise.all([
    dashboardRepository.stockSummary(warehouseId),
    dashboardRepository.movementOn(warehouseId, today),
    canSeeSales ? dashboardRepository.salesOn(warehouseId, today) : null,
    dashboardRepository.lowStockProducts(warehouseId, LIST_LIMIT),
    dashboardRepository.topMovingProducts(warehouseId, daysAgoIso(today, TOP_PRODUCTS_DAYS), 5),
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
    topProductsDays: TOP_PRODUCTS_DAYS,
  };
}

export async function getMovement(range) {
  const warehouseId = await getDefaultWarehouseId();
  return dashboardRepository.movementSeries(warehouseId, range, todayIso());
}

export async function stockValuationReport(filters) {
  const warehouseId = await getDefaultWarehouseId();
  const rows = await dashboardRepository.stockValuation(warehouseId, filters);
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
      purchaseValue: Math.round(totals.purchaseValue * 100) / 100,
      sellingValue: Math.round(totals.sellingValue * 100) / 100,
    },
  };
}

export async function movementReport(filters) {
  const warehouseId = await getDefaultWarehouseId();
  return dashboardRepository.movementReport(warehouseId, filters);
}
