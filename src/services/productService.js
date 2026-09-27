import { db } from '../config/database.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import { TXN_TYPE } from '../constants/transactionTypes.js';
import * as productRepository from '../repositories/productRepository.js';
import { getDefaultWarehouseId } from '../repositories/warehouseRepository.js';
import { ApiError } from '../utils/ApiError.js';
import * as auditService from './auditService.js';
import { applyMovement } from './inventoryService.js';

const QUICK_SEARCH_LIMIT = 20;

async function getOrThrow(id, warehouseId, trx) {
  const product = await productRepository.findById(id, warehouseId, trx);
  if (!product) throw ApiError.notFound('Product');
  return product;
}

/** Checks referenced masters exist and are active (inactive ones may be kept on update). */
async function validateReferences(trx, data, before) {
  const checks = [
    ['categoryId', 'categories', 'Category'],
    ['brandId', 'brands', 'Brand'],
    ['unitId', 'units', 'Unit'],
    ['gstRateId', 'gst_rates', 'GST rate'],
  ];
  for (const [field, table, label] of checks) {
    const id = data[field];
    if (id === undefined || id === null || before?.[field] === id) continue;
    const row = await trx(table).where({ id }).first('is_active');
    if (!row) throw ApiError.badRequest(`${label} does not exist`);
    if (!row.is_active) throw ApiError.badRequest(`${label} is inactive`);
  }
}

export async function list(filters) {
  const warehouseId = await getDefaultWarehouseId();
  return productRepository.list(warehouseId, filters);
}

export async function quickSearch(search) {
  const warehouseId = await getDefaultWarehouseId();
  return productRepository.quickSearch(warehouseId, search, QUICK_SEARCH_LIMIT);
}

export async function getById(id) {
  const warehouseId = await getDefaultWarehouseId();
  return getOrThrow(id, warehouseId);
}

export async function create({ openingStock, ...data }, context) {
  return db.transaction(async (trx) => {
    await validateReferences(trx, data);
    const warehouseId = await getDefaultWarehouseId(trx);
    const id = await productRepository.create(data, context.userId, trx);

    await trx('inventory').insert({ warehouse_id: warehouseId, product_id: id, quantity: 0 });
    // Opening stock is booked through the ledger like any other movement.
    if (openingStock > 0) {
      await applyMovement(
        trx,
        {
          productId: id,
          warehouseId,
          type: TXN_TYPE.OPENING,
          quantity: openingStock,
          unitPrice: data.purchasePrice,
          reason: 'Opening stock',
        },
        context,
      );
    }

    const product = await getOrThrow(id, warehouseId, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.CREATE,
        module: AUDIT_MODULE.PRODUCTS,
        recordId: id,
        newValue: product,
      },
      trx,
    );
    return product;
  });
}

export async function update(id, data, context) {
  return db.transaction(async (trx) => {
    const warehouseId = await getDefaultWarehouseId(trx);
    const before = await getOrThrow(id, warehouseId, trx);
    await validateReferences(trx, data, before);

    const mrp = data.mrp ?? before.mrp;
    const sellingPrice = data.sellingPrice ?? before.sellingPrice;
    if (mrp > 0 && sellingPrice > mrp) {
      throw ApiError.validation([
        { field: 'sellingPrice', message: 'Selling price cannot be higher than MRP' },
      ]);
    }

    if (data.unitId !== undefined && data.unitId !== before.unitId) {
      const unit = await trx('units').where({ id: data.unitId }).first('allow_decimal');
      const stock = Number(before.stockQuantity);
      if (!unit.allow_decimal && !Number.isInteger(stock)) {
        throw ApiError.badRequest('Current stock has decimals; choose a unit that allows decimals');
      }
    }

    await productRepository.update(id, data, context.userId, trx);
    const after = await getOrThrow(id, warehouseId, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.UPDATE,
        module: AUDIT_MODULE.PRODUCTS,
        recordId: id,
        oldValue: before,
        newValue: after,
      },
      trx,
    );
    return after;
  });
}

/** Deletes a product that has never been used. Products with history must be deactivated. */
export async function remove(id, context) {
  return db.transaction(async (trx) => {
    const warehouseId = await getDefaultWarehouseId(trx);
    const before = await getOrThrow(id, warehouseId, trx);
    if (await productRepository.hasHistory(id, trx)) {
      throw ApiError.conflict(
        'This product has stock or invoice history. Mark it inactive instead of deleting it.',
        'IN_USE',
      );
    }
    await productRepository.remove(id, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.DELETE,
        module: AUDIT_MODULE.PRODUCTS,
        recordId: id,
        oldValue: before,
      },
      trx,
    );
  });
}
