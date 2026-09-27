/**
 * Inventory: current stock per warehouse/product, the immutable transaction ledger,
 * adjustment reason codes and stock adjustments.
 */
import { auditColumns, timestamps, updatedAtTrigger } from '../utils/migrationHelpers.js';
import { TRANSACTION_TYPES } from '../constants/transactionTypes.js';

export async function up(knex) {
  await knex.schema.createTable('inventory', (t) => {
    t.increments('id');
    t.integer('warehouse_id').notNullable().references('warehouses.id').onDelete('RESTRICT');
    t.integer('product_id').notNullable().references('products.id').onDelete('RESTRICT');
    t.decimal('quantity', 14, 3).notNullable().defaultTo(0);
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['warehouse_id', 'product_id']);
    t.index(['product_id']);
  });
  // Last line of defence against negative stock; the service layer checks first
  // and returns a friendly error.
  await knex.raw('ALTER TABLE inventory ADD CONSTRAINT chk_inventory_non_negative CHECK (quantity >= 0)');
  await knex.raw(updatedAtTrigger('inventory'));

  await knex.schema.createTable('adjustment_codes', (t) => {
    t.increments('id');
    t.string('code', 30).notNullable().unique();
    t.string('name', 80).notNullable();
    // Which directions this reason may be used for.
    t.string('direction', 4).notNullable().defaultTo('BOTH');
    t.boolean('is_active').notNullable().defaultTo(true);
    auditColumns(t);
    timestamps(knex, t);
  });
  await knex.raw(
    "ALTER TABLE adjustment_codes ADD CONSTRAINT chk_adjustment_direction CHECK (direction IN ('IN','OUT','BOTH'))",
  );
  await knex.raw(updatedAtTrigger('adjustment_codes'));

  await knex.schema.createTable('inventory_transactions', (t) => {
    t.bigIncrements('id');
    t.integer('warehouse_id').notNullable().references('warehouses.id').onDelete('RESTRICT');
    t.integer('product_id').notNullable().references('products.id').onDelete('RESTRICT');
    t.string('type', 20).notNullable();
    // Signed change: positive for stock coming in, negative for stock going out.
    t.decimal('quantity', 14, 3).notNullable();
    t.decimal('previous_balance', 14, 3).notNullable();
    t.decimal('new_balance', 14, 3).notNullable();
    t.decimal('unit_price', 14, 2);
    t.integer('customer_id');
    t.string('reference_type', 30);
    t.integer('reference_id');
    t.string('reference_no', 100);
    t.string('party_name', 150);
    t.string('reason', 255);
    t.text('notes');
    t.date('txn_date').notNullable().defaultTo(knex.raw('CURRENT_DATE'));
    t.integer('created_by').references('users.id').onDelete('RESTRICT');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['product_id', 'created_at']);
    t.index(['warehouse_id', 'txn_date']);
    t.index(['type', 'txn_date']);
    t.index(['reference_type', 'reference_id']);
  });
  await knex.raw(`
    ALTER TABLE inventory_transactions
      ADD CONSTRAINT chk_inv_txn_type CHECK (type IN (${TRANSACTION_TYPES.map((x) => `'${x}'`).join(',')})),
      ADD CONSTRAINT chk_inv_txn_quantity CHECK (quantity <> 0),
      ADD CONSTRAINT chk_inv_txn_balance CHECK (new_balance = previous_balance + quantity)
  `);

  // The ledger is append-only. Corrections are made with new, reversing transactions.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'inventory_transactions is append-only (% not allowed)', TG_OP
        USING ERRCODE = 'P0001';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await knex.raw(`
    CREATE TRIGGER trg_inventory_transactions_immutable
      BEFORE UPDATE OR DELETE ON inventory_transactions
      FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
  `);

  await knex.schema.createTable('stock_adjustments', (t) => {
    t.increments('id');
    t.bigInteger('transaction_id')
      .notNullable()
      .unique()
      .references('inventory_transactions.id')
      .onDelete('RESTRICT');
    t.integer('adjustment_code_id').notNullable().references('adjustment_codes.id').onDelete('RESTRICT');
    t.string('reason', 255).notNullable();
    // Set when the adjustment came from a physical count ("set stock to X").
    t.decimal('physical_count', 14, 3);
    t.integer('created_by').references('users.id').onDelete('RESTRICT');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('stock_adjustments');
  await knex.raw('DROP TRIGGER IF EXISTS trg_inventory_transactions_immutable ON inventory_transactions');
  await knex.schema.dropTableIfExists('inventory_transactions');
  await knex.raw('DROP FUNCTION IF EXISTS prevent_ledger_mutation()');
  await knex.schema.dropTableIfExists('adjustment_codes');
  await knex.schema.dropTableIfExists('inventory');
}
