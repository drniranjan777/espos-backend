/**
 * Multi-branch operation:
 * - branch details and user ↔ branch assignment
 * - stock movement documents (multi-item Stock IN / OUT)
 * - stock transfers between branches with an approval workflow
 * - stock rows for every product in every branch
 */
import { PERMISSION_DEFINITIONS, PERMISSION_UPGRADES } from '../constants/permissions.js';
import { TRANSACTION_TYPES } from '../constants/transactionTypes.js';
import { auditColumns, timestamps, updatedAtTrigger } from '../utils/migrationHelpers.js';

const OLD_TXN_TYPES = [
  'OPENING',
  'IN',
  'OUT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'INVOICE_OUT',
  'INVOICE_CANCEL',
];

const typeCheck = (types) =>
  `ALTER TABLE inventory_transactions
     DROP CONSTRAINT chk_inv_txn_type,
     ADD CONSTRAINT chk_inv_txn_type CHECK (type IN (${types.map((t) => `'${t}'`).join(',')}))`;

export async function up(knex) {
  // ---- Branches ----
  await knex.schema.alterTable('warehouses', (t) => {
    t.string('city', 100);
    t.string('pincode', 6);
    t.string('phone', 30);
    t.string('gstin', 15);
    auditColumns(t);
  });
  await knex.raw('CREATE UNIQUE INDEX uq_warehouses_name ON warehouses (lower(name))');

  await knex.schema.createTable('warehouse_users', (t) => {
    t.integer('warehouse_id').notNullable().references('warehouses.id').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.primary(['warehouse_id', 'user_id']);
    t.index(['user_id']);
  });

  // Existing users keep working in the default branch.
  await knex.raw(`
    INSERT INTO warehouse_users (warehouse_id, user_id)
    SELECT w.id, u.id FROM users u CROSS JOIN warehouses w WHERE w.is_default
    ON CONFLICT DO NOTHING
  `);

  // Every product has a stock row in every branch, so branch stock queries never miss rows.
  await knex.raw(`
    INSERT INTO inventory (warehouse_id, product_id, quantity)
    SELECT w.id, p.id, 0 FROM warehouses w CROSS JOIN products p
    ON CONFLICT (warehouse_id, product_id) DO NOTHING
  `);

  await knex.raw(typeCheck(TRANSACTION_TYPES));

  // ---- Stock movement documents (multi-item IN / OUT) ----
  await knex.schema.createTable('stock_movements', (t) => {
    t.increments('id');
    t.string('movement_no', 30).notNullable().unique();
    t.string('type', 4).notNullable();
    t.integer('warehouse_id').notNullable().references('warehouses.id').onDelete('RESTRICT');
    t.boolean('no_bill').notNullable().defaultTo(false);
    t.string('invoice_number', 60);
    t.integer('customer_id').references('customers.id').onDelete('RESTRICT');
    // Customer (OUT) or supplier (IN) name as entered.
    t.string('party_name', 150);
    t.text('note');
    t.date('movement_date').notNullable().defaultTo(knex.raw('CURRENT_DATE'));
    t.integer('line_count').notNullable();
    t.decimal('total_quantity', 14, 3).notNullable();
    t.integer('created_by').references('users.id').onDelete('RESTRICT');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['warehouse_id', 'created_at']);
    t.index(['invoice_number']);
  });
  await knex.raw(`
    ALTER TABLE stock_movements
      ADD CONSTRAINT chk_stock_movements_type CHECK (type IN ('IN','OUT')),
      ADD CONSTRAINT chk_stock_movements_bill CHECK (no_bill OR invoice_number IS NOT NULL)
  `);

  await knex.schema.createTable('stock_movement_items', (t) => {
    t.increments('id');
    t.integer('movement_id').notNullable().references('stock_movements.id').onDelete('RESTRICT');
    t.integer('line_no').notNullable();
    t.integer('product_id').notNullable().references('products.id').onDelete('RESTRICT');
    t.decimal('quantity', 14, 3).notNullable();
    t.bigInteger('transaction_id').references('inventory_transactions.id').onDelete('RESTRICT');
    t.unique(['movement_id', 'line_no']);
    t.unique(['movement_id', 'product_id']);
  });
  await knex.raw(
    'ALTER TABLE stock_movement_items ADD CONSTRAINT chk_movement_items_qty CHECK (quantity > 0)',
  );

  // ---- Stock transfers ----
  await knex.schema.createTable('stock_transfers', (t) => {
    t.increments('id');
    t.string('transfer_no', 30).notNullable().unique();
    t.integer('from_warehouse_id').notNullable().references('warehouses.id').onDelete('RESTRICT');
    t.integer('to_warehouse_id').notNullable().references('warehouses.id').onDelete('RESTRICT');
    t.string('status', 12).notNullable().defaultTo('REQUESTED');
    t.string('invoice_number', 60);
    t.text('note');
    t.integer('line_count').notNullable();
    t.decimal('total_quantity', 14, 3).notNullable();
    t.integer('requested_by').references('users.id').onDelete('RESTRICT');
    t.timestamp('requested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('approved_by').references('users.id').onDelete('RESTRICT');
    t.timestamp('approved_at', { useTz: true });
    t.integer('received_by').references('users.id').onDelete('RESTRICT');
    t.timestamp('received_at', { useTz: true });
    t.integer('closed_by').references('users.id').onDelete('RESTRICT');
    t.timestamp('closed_at', { useTz: true });
    // Reason for rejection or cancellation.
    t.string('close_reason', 255);
    timestamps(knex, t);
    t.index(['from_warehouse_id', 'status']);
    t.index(['to_warehouse_id', 'status']);
  });
  await knex.raw(`
    ALTER TABLE stock_transfers
      ADD CONSTRAINT chk_stock_transfers_status
        CHECK (status IN ('REQUESTED','IN_TRANSIT','RECEIVED','REJECTED','CANCELLED')),
      ADD CONSTRAINT chk_stock_transfers_branches CHECK (from_warehouse_id <> to_warehouse_id)
  `);
  await knex.raw(updatedAtTrigger('stock_transfers'));

  await knex.schema.createTable('stock_transfer_items', (t) => {
    t.increments('id');
    t.integer('transfer_id').notNullable().references('stock_transfers.id').onDelete('CASCADE');
    t.integer('line_no').notNullable();
    t.integer('product_id').notNullable().references('products.id').onDelete('RESTRICT');
    t.decimal('quantity', 14, 3).notNullable();
    t.unique(['transfer_id', 'line_no']);
    t.unique(['transfer_id', 'product_id']);
  });
  await knex.raw(
    'ALTER TABLE stock_transfer_items ADD CONSTRAINT chk_transfer_items_qty CHECK (quantity > 0)',
  );

  // ---- New permissions ----
  const added = PERMISSION_DEFINITIONS.filter(([code]) =>
    ['transfer.', 'branches.'].some((prefix) => code.startsWith(prefix)),
  );
  await knex('permissions')
    .insert(added.map(([code, module, description]) => ({ code, module, description })))
    .onConflict('code')
    .ignore();

  // Admin (system role) receives everything; default roles get their documented upgrades.
  await knex.raw(
    `
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.is_system AND p.code = ANY(?)
    ON CONFLICT DO NOTHING
  `,
    [added.map(([code]) => code)],
  );
  for (const { code, roles } of PERMISSION_UPGRADES) {
    await knex.raw(
      `
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.name = ANY(?) AND p.code = ?
      ON CONFLICT DO NOTHING
    `,
      [roles, code],
    );
  }
}

export async function down(knex) {
  // The ledger is append-only, so transfer entries cannot be removed to fit the old schema.
  const transferEntry = await knex('inventory_transactions')
    .whereIn('type', ['TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_RETURN'])
    .first('id');
  if (transferEntry) {
    throw new Error(
      'Cannot roll back: the inventory ledger already contains stock transfer entries. Restore a backup instead.',
    );
  }
  await knex('permissions')
    .where((q) => q.whereLike('code', 'transfer.%').orWhereLike('code', 'branches.%'))
    .del();
  await knex.schema.dropTableIfExists('stock_transfer_items');
  await knex.schema.dropTableIfExists('stock_transfers');
  await knex.schema.dropTableIfExists('stock_movement_items');
  await knex.schema.dropTableIfExists('stock_movements');
  // Transfer ledger rows must not exist when going back to the old type list.
  await knex.raw(typeCheck(OLD_TXN_TYPES));
  await knex.schema.dropTableIfExists('warehouse_users');
  await knex.raw('DROP INDEX IF EXISTS uq_warehouses_name');
  await knex.schema.alterTable('warehouses', (t) => {
    t.dropColumns('city', 'pincode', 'phone', 'gstin', 'created_by', 'updated_by');
  });
}
