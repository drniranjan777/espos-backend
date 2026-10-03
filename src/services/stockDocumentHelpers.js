import Decimal from 'decimal.js';
import * as inventoryRepository from '../repositories/inventoryRepository.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Combines lines for the same product (keeping first-seen order) so a document never
 * books one product twice.
 */
export function mergeLines(items) {
  const byProduct = new Map();
  for (const item of items) {
    const existing = byProduct.get(item.productId);
    byProduct.set(
      item.productId,
      existing
        ? { ...existing, quantity: new Decimal(existing.quantity).plus(item.quantity).toNumber() }
        : { productId: item.productId, quantity: item.quantity },
    );
  }
  return [...byProduct.values()];
}

export function totalQuantity(lines) {
  return lines.reduce((sum, line) => sum.plus(line.quantity), new Decimal(0)).toNumber();
}

/** Lines sorted by product id: stock rows are always locked in this order (no deadlocks). */
export const lockOrder = (lines) => [...lines].sort((a, b) => a.productId - b.productId);

/**
 * Locks the branch stock rows of all lines and checks every line has enough stock.
 * Reports every short line at once so the user can fix the whole document in one go.
 */
export async function assertStockAvailable(trx, warehouseId, lines) {
  const products = new Map(
    (
      await trx('products as p')
        .join('units as un', 'un.id', 'p.unit_id')
        .whereIn(
          'p.id',
          lines.map((l) => l.productId),
        )
        .select('p.id', 'p.name', 'p.sku', 'un.code as unitCode')
    ).map((p) => [p.id, p]),
  );

  const shortages = [];
  for (const line of lockOrder(lines)) {
    const product = products.get(line.productId);
    if (!product) throw ApiError.badRequest(`Product ${line.productId} does not exist`);
    const stock = await inventoryRepository.lockStockRow(trx, warehouseId, line.productId);
    if (new Decimal(stock.quantity).lessThan(line.quantity)) {
      shortages.push({
        productId: line.productId,
        name: product.name,
        sku: product.sku,
        unitCode: product.unitCode,
        available: Number(stock.quantity),
        requested: Number(line.quantity),
      });
    }
  }

  if (shortages.length) {
    const summary = shortages
      .map((s) => `${s.name}: ${s.available} ${s.unitCode} available, ${s.requested} requested`)
      .join('; ');
    throw ApiError.conflict(`Insufficient stock. ${summary}`, 'INSUFFICIENT_STOCK', {
      lines: shortages,
    });
  }
}
