/**
 * Customers, company settings, invoice numbering and invoices.
 */
import { auditColumns, timestamps, updatedAtTrigger } from '../utils/migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('customers', (t) => {
    t.increments('id');
    t.string('name', 150).notNullable();
    t.string('company_name', 150);
    t.string('mobile', 15);
    t.string('email', 150);
    t.string('gstin', 15);
    t.text('billing_address');
    t.text('shipping_address');
    t.string('state', 100);
    t.string('state_code', 2);
    t.string('city', 100);
    t.string('pincode', 6);
    t.boolean('is_active').notNullable().defaultTo(true);
    auditColumns(t);
    timestamps(knex, t);
  });
  await knex.raw(
    'CREATE UNIQUE INDEX uq_customers_gstin ON customers (upper(gstin)) WHERE gstin IS NOT NULL',
  );
  await knex.raw('CREATE INDEX idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops)');
  await knex.raw('CREATE INDEX idx_customers_mobile ON customers (mobile)');
  await knex.raw(updatedAtTrigger('customers'));

  // Exactly one row (id = 1).
  await knex.schema.createTable('company_settings', (t) => {
    t.integer('id').primary();
    t.string('company_name', 200).notNullable();
    t.string('logo_path', 255);
    t.text('address');
    t.string('city', 100);
    t.string('pincode', 6);
    t.string('phone', 30);
    t.string('email', 150);
    t.string('gstin', 15);
    t.string('pan', 10);
    t.string('state', 100);
    t.string('state_code', 2);
    t.string('bank_name', 120);
    t.string('bank_account_name', 150);
    t.string('bank_account_number', 30);
    t.string('bank_ifsc', 11);
    t.string('bank_branch', 120);
    t.text('terms_and_conditions');
    t.string('invoice_prefix', 20).notNullable().defaultTo('INV');
    t.integer('invoice_number_padding').notNullable().defaultTo(4);
    t.integer('updated_by').references('users.id').onDelete('SET NULL');
    timestamps(knex, t);
  });
  await knex.raw(
    'ALTER TABLE company_settings ADD CONSTRAINT chk_company_settings_singleton CHECK (id = 1)',
  );
  await knex.raw(updatedAtTrigger('company_settings'));

  // Gap-free invoice counters per prefix + Indian financial year (e.g. 2026-27).
  await knex.schema.createTable('invoice_sequences', (t) => {
    t.increments('id');
    t.string('prefix', 20).notNullable();
    t.string('financial_year', 7).notNullable();
    t.integer('last_number').notNullable().defaultTo(0);
    t.unique(['prefix', 'financial_year']);
  });

  await knex.schema.createTable('invoices', (t) => {
    t.increments('id');
    // NULL while DRAFT; assigned when finalized.
    t.string('invoice_no', 50).unique();
    t.date('invoice_date').notNullable();
    t.string('status', 12).notNullable().defaultTo('DRAFT');
    t.integer('warehouse_id').notNullable().references('warehouses.id').onDelete('RESTRICT');
    t.integer('customer_id').notNullable().references('customers.id').onDelete('RESTRICT');
    // Customer snapshot, so later edits to the customer never change an issued invoice.
    t.string('customer_name', 150).notNullable();
    t.string('customer_company_name', 150);
    t.string('customer_gstin', 15);
    t.string('customer_mobile', 15);
    t.string('customer_email', 150);
    t.text('billing_address');
    t.text('shipping_address');
    t.string('customer_state', 100);
    t.string('customer_state_code', 2);
    t.string('place_of_supply_state_code', 2);
    t.string('supply_type', 5).notNullable();
    t.decimal('subtotal', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_discount', 14, 2).notNullable().defaultTo(0);
    t.decimal('taxable_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('cgst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('sgst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('igst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_tax', 14, 2).notNullable().defaultTo(0);
    t.decimal('round_off', 6, 2).notNullable().defaultTo(0);
    t.decimal('grand_total', 14, 2).notNullable().defaultTo(0);
    t.text('notes');
    // Company snapshot taken at finalization (address/GSTIN/bank as printed on the invoice).
    t.jsonb('company_snapshot');
    t.timestamp('finalized_at', { useTz: true });
    t.integer('finalized_by').references('users.id').onDelete('SET NULL');
    t.timestamp('cancelled_at', { useTz: true });
    t.integer('cancelled_by').references('users.id').onDelete('SET NULL');
    t.string('cancel_reason', 255);
    auditColumns(t);
    timestamps(knex, t);
    t.index(['invoice_date']);
    t.index(['customer_id']);
    t.index(['status', 'invoice_date']);
  });
  await knex.raw(`
    ALTER TABLE invoices
      ADD CONSTRAINT chk_invoices_status CHECK (status IN ('DRAFT','FINAL','CANCELLED')),
      ADD CONSTRAINT chk_invoices_supply_type CHECK (supply_type IN ('INTRA','INTER')),
      ADD CONSTRAINT chk_invoices_number CHECK (status = 'DRAFT' OR invoice_no IS NOT NULL)
  `);
  await knex.raw(updatedAtTrigger('invoices'));

  await knex.schema.createTable('invoice_items', (t) => {
    t.increments('id');
    t.integer('invoice_id').notNullable().references('invoices.id').onDelete('CASCADE');
    t.integer('line_no').notNullable();
    t.integer('product_id').notNullable().references('products.id').onDelete('RESTRICT');
    t.string('product_name', 200).notNullable();
    t.string('sku', 60);
    t.string('part_number', 80);
    t.string('hsn_code', 8);
    t.string('unit', 10);
    t.decimal('quantity', 14, 3).notNullable();
    t.decimal('rate', 14, 2).notNullable();
    t.decimal('discount_percent', 5, 2).notNullable().defaultTo(0);
    t.decimal('discount_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('taxable_value', 14, 2).notNullable();
    t.decimal('gst_rate', 5, 2).notNullable();
    t.decimal('cgst_rate', 5, 2).notNullable().defaultTo(0);
    t.decimal('cgst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('sgst_rate', 5, 2).notNullable().defaultTo(0);
    t.decimal('sgst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('igst_rate', 5, 2).notNullable().defaultTo(0);
    t.decimal('igst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('line_total', 14, 2).notNullable();
    t.unique(['invoice_id', 'line_no']);
    t.index(['product_id']);
  });
  await knex.raw(`
    ALTER TABLE invoice_items
      ADD CONSTRAINT chk_invoice_items_qty CHECK (quantity > 0),
      ADD CONSTRAINT chk_invoice_items_rate CHECK (rate >= 0),
      ADD CONSTRAINT chk_invoice_items_discount CHECK (discount_percent >= 0 AND discount_percent <= 100)
  `);

  // Ledger rows may point at a customer (stock out / invoice).
  await knex.raw(`
    ALTER TABLE inventory_transactions
      ADD CONSTRAINT fk_inv_txn_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
  `);
}

export async function down(knex) {
  await knex.raw(
    'ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS fk_inv_txn_customer',
  );
  await knex.schema.dropTableIfExists('invoice_items');
  await knex.schema.dropTableIfExists('invoices');
  await knex.schema.dropTableIfExists('invoice_sequences');
  await knex.schema.dropTableIfExists('company_settings');
  await knex.schema.dropTableIfExists('customers');
}
