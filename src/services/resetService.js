import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../config/database.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import * as userRepository from '../repositories/userRepository.js';
import { ApiError } from '../utils/ApiError.js';
import * as auditService from './auditService.js';

/**
 * Reset Everything: removes only the business data groups the Admin selects. Nothing is
 * "delete all": users, roles, branches, company settings, masters (categories, brands, units,
 * GST rates, adjustment reasons) and the audit trail are never touched. Each group lists the
 * exact tables it clears; a group that other data points to can only be reset together with
 * the groups that point to it, so no record is ever left dangling.
 */

export const RESET_PHRASE = 'RESET';

/** Group id -> what it clears. `tables` are emptied in one TRUNCATE inside one transaction. */
export const SCOPES = {
  stock_history: {
    label: 'Stock history',
    description:
      'Stock IN / OUT entries, transfers, billing (purchase) invoices, the inventory ledger, adjustments and purchase price history. Stock on hand of every product becomes 0.',
    tables: [
      'stock_adjustments',
      'inventory_transactions',
      'stock_movement_items',
      'stock_movements',
      'purchase_invoice_items',
      'purchase_invoices',
      'product_price_history',
      'stock_transfer_items',
      'stock_transfers',
    ],
    sequencePrefixes: ['SI', 'SO', 'PI', 'ST'],
    requires: [],
  },
  invoices: {
    label: 'Sales invoices',
    description: 'All GST sales invoices and their items. Invoice numbering starts again from 1.',
    tables: ['invoice_items', 'invoices'],
    requires: [],
  },
  products: {
    label: 'Products',
    description:
      'The product list and the stock rows of every branch. Categories, brands and units stay.',
    tables: ['inventory', 'products'],
    requires: ['stock_history', 'invoices'],
  },
  customers: {
    label: 'Customers & suppliers',
    description: 'The customer and supplier list.',
    tables: ['customers'],
    requires: ['stock_history', 'invoices'],
  },
};

/** Always kept; shown to the Admin so the promise is explicit. */
export const KEPT = [
  'Users, roles and permissions',
  'Branches',
  'Company settings and logo',
  'Categories, brands, units, GST rates and adjustment reasons',
  'Audit trail (this reset is added to it)',
];

const SCOPE_IDS = Object.keys(SCOPES);

export function describe() {
  return {
    scopes: SCOPE_IDS.map((id) => ({ id, ...SCOPES[id] })),
    kept: KEPT,
    phrase: RESET_PHRASE,
  };
}

/** Throws unless the selection is non-empty, known, and includes everything it depends on. */
export function assertValidScopes(scopes) {
  const unique = [...new Set(scopes)];
  if (!unique.length) throw ApiError.badRequest('Select what to reset');
  const unknown = unique.filter((s) => !SCOPES[s]);
  if (unknown.length) throw ApiError.badRequest(`Unknown reset option: ${unknown.join(', ')}`);
  for (const id of unique) {
    const missing = SCOPES[id].requires.filter((r) => !unique.includes(r));
    if (missing.length) {
      throw ApiError.badRequest(
        `${SCOPES[id].label} can only be reset together with ${missing.map((m) => SCOPES[m].label).join(' and ')}`,
      );
    }
  }
  return unique;
}

const tablesOf = (scopes) => scopes.flatMap((id) => SCOPES[id].tables);

async function countRows(trx, tables) {
  const counts = {};
  for (const table of tables) {
    const [{ count }] = await trx(table).count({ count: '*' });
    counts[table] = Number(count);
  }
  return counts;
}

/** Exactly what a reset of these groups would remove, row counts per table. Changes nothing. */
export async function preview(scopes) {
  const ids = assertValidScopes(scopes);
  const counts = await countRows(db, tablesOf(ids));
  const [{ count: withStock }] = await db('inventory')
    .where('quantity', '>', 0)
    .count({ count: '*' });
  return {
    scopes: ids.map((id) => ({
      id,
      label: SCOPES[id].label,
      description: SCOPES[id].description,
      tables: SCOPES[id].tables.map((table) => ({ table, rows: counts[table] })),
    })),
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    stockRowsSetToZero:
      ids.includes('stock_history') && !ids.includes('products') ? Number(withStock) : 0,
    kept: KEPT,
  };
}

// ---- Backups ----------------------------------------------------------------------------
// A backup is a JSON file of every row the reset would remove. Downloading one gives the
// browser a backup id; the reset accepts it (or an explicit "no backup" choice).

const BACKUP_TTL_MS = 30 * 60 * 1000;
const backups = new Map();
const scopeKey = (scopes) => [...scopes].sort().join(',');

function rememberBackup(userId, scopes) {
  const now = Date.now();
  for (const [id, b] of backups) if (b.expires < now) backups.delete(id);
  const id = crypto.randomUUID();
  backups.set(id, { userId, scopes: scopeKey(scopes), expires: now + BACKUP_TTL_MS });
  return id;
}

function backupCovers(backupId, userId, scopes) {
  const b = backups.get(backupId);
  return Boolean(b && b.expires > Date.now() && b.userId === userId && b.scopes === scopeKey(scopes));
}

export async function createBackup(scopes, user, context) {
  const ids = assertValidScopes(scopes);
  const data = {};
  for (const table of tablesOf(ids)) data[table] = await db(table).select('*').orderByRaw('1');
  const backupId = rememberBackup(user.id, ids);
  await auditService.log(context, {
    action: AUDIT_ACTION.BACKUP,
    module: AUDIT_MODULE.SYSTEM,
    recordId: backupId,
    newValue: {
      scopes: ids,
      rows: Object.fromEntries(Object.entries(data).map(([t, r]) => [t, r.length])),
    },
  });
  return {
    backupId,
    file: {
      app: 'jcb-inventory',
      kind: 'reset-backup',
      createdAt: new Date().toISOString(),
      createdBy: user.username,
      scopes: ids,
      tables: data,
    },
  };
}

// ---- Reset ------------------------------------------------------------------------------

/**
 * @param {{ scopes: string[], phrase: string, password: string, backupId?: string, skipBackup?: boolean }} input
 */
export async function reset(input, user, context) {
  const ids = assertValidScopes(input.scopes);
  if (input.phrase !== RESET_PHRASE) throw ApiError.badRequest(`Type ${RESET_PHRASE} to confirm`);

  const hash = await userRepository.findPasswordHash(user.id);
  if (!hash || !(await bcrypt.compare(input.password, hash))) {
    throw ApiError.badRequest('Your password is incorrect');
  }
  const backedUp = Boolean(input.backupId) && backupCovers(input.backupId, user.id, ids);
  if (!backedUp && !input.skipBackup) {
    throw ApiError.badRequest(
      'Download a backup of this data first, or choose to continue without one',
    );
  }

  return db.transaction(async (trx) => {
    const tables = tablesOf(ids);
    const removed = await countRows(trx, tables);

    // One statement: TRUNCATE checks foreign keys across the listed tables together.
    await trx.raw(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);

    if (ids.includes('stock_history') && !ids.includes('products')) {
      // The ledger is gone, so stock on hand starts again from zero and never disagrees with it.
      await trx('inventory').update({ quantity: 0 });
    }
    const prefixes = ids.flatMap((id) => SCOPES[id].sequencePrefixes ?? []);
    if (ids.includes('invoices')) {
      const settings = await trx('company_settings').where({ id: 1 }).first('invoice_prefix');
      if (settings?.invoice_prefix) prefixes.push(settings.invoice_prefix);
    }
    if (prefixes.length) await trx('invoice_sequences').whereIn('prefix', prefixes).del();

    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.RESET,
        module: AUDIT_MODULE.SYSTEM,
        recordId: null,
        newValue: { scopes: ids, removed, backup: backedUp, backupId: backedUp ? input.backupId : null },
      },
      trx,
    );
    return { scopes: ids, removed, backedUp };
  });
}
