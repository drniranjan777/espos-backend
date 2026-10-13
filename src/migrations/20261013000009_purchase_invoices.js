/**
 * Purchase side of Stock IN:
 * - the purchase price paid on each Stock IN line (and the price before it)
 * - a billing (purchase) invoice created with every Stock IN
 * - purchase price history per product
 * - a client request id on stock entries, so a retried submit is not booked twice
 */
import { PERMISSION_DEFINITIONS } from '../constants/permissions.js';
import { timestamps, updatedAtTrigger } from '../utils/migrationHelpers.js';

export async function up(knex) {
  await knex.schema.alterTable('stock_movements', (t) => {
    t.uuid('client_request_id').unique();
  });

  // NULL on Stock OUT lines and on entries recorded before this change.
  await knex.schema.alterTable('stock_movement_items', (t) => {
    t.decimal('previous_purchase_price', 14, 2);
    t.decimal('purchase_price', 14, 2);
  });
  await knex.raw(`
    ALTER TABLE stock_movement_items
      ADD CONSTRAINT chk_movement_items_price
        CHECK (purchase_price IS NULL OR purchase_price >= 0)
  `);

  await knex.schema.createTable('purchase_invoices', (t) => {
    t.increments('id');
    t.string('invoice_no', 30).notNullable().unique();
    // One invoice per Stock IN entry: the unique key also stops duplicates.
    t.integer('movement_id')
      .notNullable()
      .unique()
      .references('stock_movements.id')
      .onDelete('RESTRICT');
    t.integer('warehouse_id').notNullable().references('warehouses.id').onDelete('RESTRICT');
    t.date('invoice_date').notNullable();
    t.string('status', 12).notNullable().defaultTo('POSTED');
    // Stock received without a supplier bill: an internal record, no tax.
    t.boolean('no_bill').notNullable().defaultTo(false);
    t.integer('supplier_id').references('customers.id').onDelete('RESTRICT');
    // Supplier snapshot, so later edits never change a recorded invoice.
    t.string('supplier_name', 150);
    t.string('supplier_gstin', 15);
    t.string('supplier_state_code', 2);
    t.string('supplier_invoice_number', 60);
    t.string('supply_type', 5).notNullable();
    t.decimal('subtotal', 14, 2).notNullable().defaultTo(0);
    t.decimal('taxable_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('cgst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('sgst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('igst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_tax', 14, 2).notNullable().defaultTo(0);
    t.decimal('round_off', 6, 2).notNullable().defaultTo(0);
    t.decimal('grand_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('paid_amount', 14, 2).notNullable().defaultTo(0);
    t.string('payment_status', 8).notNullable().defaultTo('UNPAID');
    t.text('notes');
    t.integer('created_by').references('users.id').onDelete('SET NULL');
    t.integer('updated_by').references('users.id').onDelete('SET NULL');
    timestamps(knex, t);
    t.index(['warehouse_id', 'invoice_date']);
    t.index(['supplier_id']);
    t.index(['payment_status']);
  });
  await knex.raw(`
    ALTER TABLE purchase_invoices
      ADD CONSTRAINT chk_purchase_invoices_status CHECK (status IN ('POSTED','CANCELLED')),
      ADD CONSTRAINT chk_purchase_invoices_supply_type CHECK (supply_type IN ('INTRA','INTER')),
      ADD CONSTRAINT chk_purchase_invoices_payment
        CHECK (payment_status IN ('UNPAID','PARTIAL','PAID')),
      ADD CONSTRAINT chk_purchase_invoices_paid
        CHECK (paid_amount >= 0 AND paid_amount <= grand_total)
  `);
  await knex.raw(updatedAtTrigger('purchase_invoices'));

  await knex.schema.createTable('purchase_invoice_items', (t) => {
    t.increments('id');
    t.integer('purchase_invoice_id')
      .notNullable()
      .references('purchase_invoices.id')
      .onDelete('CASCADE');
    t.integer('line_no').notNullable();
    t.integer('product_id').notNullable().references('products.id').onDelete('RESTRICT');
    t.string('product_name', 200).notNullable();
    t.string('sku', 60);
    t.string('part_number', 80);
    t.string('hsn_code', 8);
    t.string('unit', 10);
    t.decimal('quantity', 14, 3).notNullable();
    t.decimal('previous_rate', 14, 2).notNullable();
    t.decimal('rate', 14, 2).notNullable();
    t.decimal('taxable_value', 14, 2).notNullable();
    t.decimal('gst_rate', 5, 2).notNullable();
    t.decimal('cgst_rate', 5, 2).notNullable().defaultTo(0);
    t.decimal('cgst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('sgst_rate', 5, 2).notNullable().defaultTo(0);
    t.decimal('sgst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('igst_rate', 5, 2).notNullable().defaultTo(0);
    t.decimal('igst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('line_total', 14, 2).notNullable();
    t.unique(['purchase_invoice_id', 'line_no']);
    t.index(['product_id']);
  });
  await knex.raw(`
    ALTER TABLE purchase_invoice_items
      ADD CONSTRAINT chk_purchase_items_qty CHECK (quantity > 0),
      ADD CONSTRAINT chk_purchase_items_rate CHECK (rate >= 0)
  `);

  await knex.schema.createTable('product_price_history', (t) => {
    t.increments('id');
    t.integer('product_id').notNullable().references('products.id').onDelete('CASCADE');
    t.decimal('old_price', 14, 2).notNullable();
    t.decimal('new_price', 14, 2).notNullable();
    t.integer('movement_id').references('stock_movements.id').onDelete('SET NULL');
    t.integer('changed_by').references('users.id').onDelete('SET NULL');
    t.timestamp('changed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['product_id', 'changed_at']);
  });

  // ---- New permissions: Admin (system role) receives them; other roles are granted
  // in Users & Roles. ----
  const added = PERMISSION_DEFINITIONS.filter(([code]) => code.startsWith('purchase.'));
  await knex('permissions')
    .insert(added.map(([code, module, description]) => ({ code, module, description })))
    .onConflict('code')
    .ignore();
  await knex.raw(
    `
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.is_system AND p.code = ANY(?)
    ON CONFLICT DO NOTHING
  `,
    [added.map(([code]) => code)],
  );
}

export async function down(knex) {
  await knex('permissions').whereLike('code', 'purchase.%').del();
  await knex.schema.dropTableIfExists('product_price_history');
  await knex.schema.dropTableIfExists('purchase_invoice_items');
  await knex.schema.dropTableIfExists('purchase_invoices');
  await knex.raw(
    'ALTER TABLE stock_movement_items DROP CONSTRAINT IF EXISTS chk_movement_items_price',
  );
  await knex.schema.alterTable('stock_movement_items', (t) => {
    t.dropColumns('previous_purchase_price', 'purchase_price');
  });
  await knex.schema.alterTable('stock_movements', (t) => {
    t.dropColumn('client_request_id');
  });
}
