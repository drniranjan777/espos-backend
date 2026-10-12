import { db } from '../config/database.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import { TXN_TYPE } from '../constants/transactionTypes.js';
import * as productRepository from '../repositories/productRepository.js';
import { ApiError } from '../utils/ApiError.js';
import * as auditService from './auditService.js';
import { applyMovement } from './inventoryService.js';

/**
 * Bulk import of parts with opening stock from the Excel template (the browser reads the
 * file and sends its rows). One row per part; a part held in several branches repeats its
 * SKU with another branch and quantity. Every row is checked first and problems are
 * reported by Excel row number; nothing is saved unless the whole file is valid.
 * Parts whose SKU already exists are left untouched and listed as skipped.
 */

export const MAX_IMPORT_ROWS = 5000;
const MAX_NUMBER = 99_999_999;
const MAX_PRICE = 999_999_999_999;
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9\-_/.]*$/;

/** Cell value as trimmed text ('' when empty). Numbers typed in text columns are kept. */
const text = (value) => (value === null || value === undefined ? '' : String(value).trim());

/** Cell value as a number; '' → null (blank), NaN when it is not a number. */
function number(value) {
  const raw = text(value).replace(/,/g, '');
  if (!raw) return null;
  return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
}

const key = (value) => text(value).toLowerCase();

async function loadLookups(trx, skus, user) {
  const [units, gstRates, categories, brands, existing] = await Promise.all([
    trx('units').select('id', 'code', 'allow_decimal', 'is_active'),
    trx('gst_rates').where('is_active', true).select('id', 'rate'),
    trx('categories').select('id', 'name', 'is_active'),
    trx('brands').select('id', 'name', 'is_active'),
    skus.length ? trx('products').whereIn('sku', skus).select('sku') : [],
  ]);
  const branches = new Map();
  for (const b of user.branches) {
    branches.set(key(b.name), b);
    if (b.code) branches.set(key(b.code), b);
  }
  return {
    units: new Map(units.map((u) => [u.code.toUpperCase(), u])),
    gstRates: new Map(gstRates.map((g) => [Number(g.rate), g.id])),
    categories: new Map(categories.map((c) => [key(c.name), c])),
    brands: new Map(brands.map((b) => [key(b.name), b])),
    existingSkus: new Set(existing.map((p) => p.sku.toUpperCase())),
    branches,
  };
}

/** Reads a non-negative number cell; reports an error and returns 0 when it is invalid. */
function amount(row, field, label, max, fail) {
  const value = number(row[field]);
  if (value === null) return 0;
  if (Number.isNaN(value)) fail(field, `${label} must be a number`);
  else if (value < 0) fail(field, `${label} cannot be negative`);
  else if (value > max) fail(field, `${label} is too large`);
  else return value;
  return 0;
}

/** Branch and opening stock of a row (read from every row of a part). */
function readStock(row, unit, lookups, currentBranch, fail) {
  const branchName = text(row.branch);
  let branch = currentBranch;
  if (branchName) {
    branch = lookups.branches.get(key(branchName));
    if (!branch) fail('branch', `Branch “${branchName}” does not exist or you cannot use it`);
  }
  const quantity = amount(row, 'openingStock', 'Opening stock', MAX_NUMBER, fail);
  if (unit && !unit.allow_decimal && !Number.isInteger(quantity)) {
    fail('openingStock', `Opening stock must be a whole number for unit ${unit.code}`);
  }
  return { branch, quantity };
}

/** Details of a part, read from the first row of its SKU. */
function readProduct(row, sku, lookups, fail) {
  const name = text(row.name);
  if (!name) fail('name', 'Part name is required');
  else if (name.length > 200) fail('name', 'Part name can be up to 200 characters');

  const limited = (field, label, max) => {
    const value = text(row[field]);
    if (value.length > max) fail(field, `${label} can be up to ${max} characters`);
    return value || null;
  };

  const unitCode = text(row.unit).toUpperCase();
  const unit = lookups.units.get(unitCode);
  if (!unitCode) fail('unit', 'Unit is required');
  else if (!unit || !unit.is_active) {
    fail('unit', `Unit “${unitCode}” is not in the list (${[...lookups.units.keys()].join(', ')})`);
  }

  const hsnCode = text(row.hsnCode);
  if (hsnCode && !/^[0-9]{4,8}$/.test(hsnCode)) fail('hsnCode', 'HSN code must be 4 to 8 digits');

  const purchasePrice = amount(row, 'purchasePrice', 'Purchase price', MAX_PRICE, fail);
  const sellingPrice = amount(row, 'sellingPrice', 'Selling price', MAX_PRICE, fail);
  const mrp = amount(row, 'mrp', 'MRP', MAX_PRICE, fail);
  if (mrp > 0 && sellingPrice > mrp) {
    fail('sellingPrice', 'Selling price cannot be higher than MRP');
  }

  let gstRateId = null;
  const gst = number(text(row.gstRate).replace(/%$/, ''));
  if (gst !== null) {
    gstRateId = lookups.gstRates.get(gst) ?? null;
    if (gstRateId === null) {
      fail('gstRate', `GST % must be one of ${[...lookups.gstRates.keys()].join(', ')}`);
    }
  }

  const master = (field, label, existing) => {
    const value = limited(field, label, 100);
    if (value && existing.get(key(value))?.is_active === false) {
      fail(field, `${label} “${value}” is inactive`);
    }
    return value;
  };

  return {
    unit,
    data: {
      name,
      sku,
      partNumber: limited('partNumber', 'Part number', 80),
      machineModel: limited('machineModel', 'Machine model', 120),
      unitId: unit?.id,
      hsnCode: hsnCode || null,
      purchasePrice: Math.round(purchasePrice * 100) / 100,
      sellingPrice: Math.round(sellingPrice * 100) / 100,
      mrp: Math.round(mrp * 100) / 100,
      gstRateId,
      minStockLevel: amount(row, 'minStockLevel', 'Min stock level', MAX_NUMBER, fail),
      description: limited('description', 'Description', 2000),
    },
    category: master('category', 'Category', lookups.categories),
    brand: master('brand', 'Brand', lookups.brands),
  };
}

/** Checks every row and groups rows into the parts to create. Saves nothing. */
function plan(rows, lookups, currentBranch) {
  const errors = [];
  const skipped = [];
  const parts = new Map();

  for (const row of rows) {
    const sku = text(row.sku).toUpperCase();
    const fail = (field, message) => errors.push({ row: row.rowNumber, sku, field, message });

    if (!sku) {
      fail('sku', 'SKU is required');
      continue;
    }
    if (sku.length > 60 || !SKU_PATTERN.test(sku)) {
      fail('sku', 'SKU may contain letters, numbers and - _ / . only (up to 60 characters)');
      continue;
    }
    if (lookups.existingSkus.has(sku)) {
      skipped.push({ row: row.rowNumber, sku, reason: 'A part with this SKU already exists' });
      continue;
    }

    let part = parts.get(sku);
    if (!part) {
      part = { ...readProduct(row, sku, lookups, fail), stock: new Map() };
      parts.set(sku, part);
    }
    const { branch, quantity } = readStock(row, part.unit, lookups, currentBranch, fail);
    if (!branch) continue;
    if (part.stock.has(branch.id)) {
      fail('branch', `SKU ${sku} is listed twice for branch ${branch.name}`);
    } else {
      part.stock.set(branch.id, quantity);
    }
  }
  return { errors, skipped, parts: [...parts.values()] };
}

/** Names in the file that are not in a master list yet (first spelling wins). */
function newNames(parts, field, existing) {
  const names = new Map();
  for (const part of parts) {
    const name = part[field];
    if (name && !existing.has(key(name)) && !names.has(key(name))) names.set(key(name), name);
  }
  return [...names.values()];
}

async function createMasters(trx, table, names, existing, userId) {
  for (const name of names) {
    const [row] = await trx(table).insert({ name, created_by: userId }).returning('id');
    existing.set(key(name), { id: row.id, name, is_active: true });
  }
}

async function save(trx, planned, lookups, newCategories, newBrands, context) {
  await createMasters(trx, 'categories', newCategories, lookups.categories, context.userId);
  await createMasters(trx, 'brands', newBrands, lookups.brands, context.userId);

  for (const part of planned.parts) {
    const id = await productRepository.create(
      {
        ...part.data,
        categoryId: part.category ? lookups.categories.get(key(part.category)).id : null,
        brandId: part.brand ? lookups.brands.get(key(part.brand)).id : null,
      },
      context.userId,
      trx,
    );
    await productRepository.createStockRows(id, trx);
    // Opening stock is booked through the ledger like any other movement.
    for (const [warehouseId, quantity] of part.stock) {
      if (quantity > 0) {
        await applyMovement(
          trx,
          {
            productId: id,
            warehouseId,
            type: TXN_TYPE.OPENING,
            quantity,
            unitPrice: part.data.purchasePrice,
            reason: 'Opening stock (Excel import)',
          },
          { ...context, warehouseId },
        );
      }
    }
  }
}

/**
 * @param {object[]} rows       rows of the template, each with `rowNumber` (Excel row)
 * @param {{ dryRun: boolean }} options  dryRun checks the file and saves nothing
 * @param {object} context      request context (userId, warehouseId, …)
 * @param {object} user         authenticated user (branches)
 * @param {{ id: number, name: string }} branch  current branch, used when Branch is blank
 */
export async function importProducts(rows, { dryRun }, context, user, branch) {
  const skus = [...new Set(rows.map((r) => text(r.sku).toUpperCase()).filter(Boolean))];

  return db.transaction(async (trx) => {
    const lookups = await loadLookups(trx, skus, user);
    const planned = plan(rows, lookups, branch);
    const newCategories = newNames(planned.parts, 'category', lookups.categories);
    const newBrands = newNames(planned.parts, 'brand', lookups.brands);
    const withStock = planned.parts.filter((p) => [...p.stock.values()].some((q) => q > 0));

    const result = {
      imported: false,
      totalRows: rows.length,
      partsToCreate: planned.parts.length,
      partsWithStock: withStock.length,
      defaultBranch: branch.name,
      newCategories,
      newBrands,
      skipped: planned.skipped,
      errors: planned.errors,
    };
    if (dryRun) return result;

    if (planned.errors.length) {
      throw new ApiError(
        422,
        'IMPORT_INVALID',
        'The file has errors. Fix them and upload it again.',
        planned.errors,
      );
    }
    if (!planned.parts.length) {
      throw ApiError.badRequest('There are no new parts to import in this file');
    }

    await save(trx, planned, lookups, newCategories, newBrands, context);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.CREATE,
        module: AUDIT_MODULE.PRODUCTS,
        recordId: null,
        newValue: {
          import: 'excel',
          parts: planned.parts.length,
          partsWithStock: withStock.length,
          skipped: planned.skipped.length,
          newCategories,
          newBrands,
        },
      },
      trx,
    );
    return { ...result, imported: true };
  });
}
