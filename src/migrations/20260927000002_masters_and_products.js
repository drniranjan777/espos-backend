/**
 * Masters (categories, brands, units, GST rates) and the product master.
 */
import { auditColumns, timestamps, updatedAtTrigger } from '../utils/migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('categories', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.integer('parent_id').references('categories.id').onDelete('RESTRICT');
    t.string('description', 255);
    t.boolean('is_active').notNullable().defaultTo(true);
    auditColumns(t);
    timestamps(knex, t);
  });
  // Same name allowed under different parents, never twice under the same parent.
  await knex.raw(
    'CREATE UNIQUE INDEX uq_categories_name_parent ON categories (lower(name), COALESCE(parent_id, 0))',
  );
  await knex.raw(updatedAtTrigger('categories'));

  await knex.schema.createTable('brands', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    auditColumns(t);
    timestamps(knex, t);
  });
  await knex.raw('CREATE UNIQUE INDEX uq_brands_name ON brands (lower(name))');
  await knex.raw(updatedAtTrigger('brands'));

  await knex.schema.createTable('units', (t) => {
    t.increments('id');
    t.string('name', 50).notNullable();
    t.string('code', 10).notNullable();
    // Whether quantities in this unit may have decimals (e.g. litres) or must be whole (pieces).
    t.boolean('allow_decimal').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    auditColumns(t);
    timestamps(knex, t);
  });
  await knex.raw('CREATE UNIQUE INDEX uq_units_code ON units (upper(code))');
  await knex.raw(updatedAtTrigger('units'));

  await knex.schema.createTable('gst_rates', (t) => {
    t.increments('id');
    t.string('name', 50).notNullable();
    t.decimal('rate', 5, 2).notNullable().unique();
    t.boolean('is_active').notNullable().defaultTo(true);
    auditColumns(t);
    timestamps(knex, t);
  });
  // Intra-state: CGST + SGST (half each). Inter-state: IGST (full rate).
  await knex.raw(`
    ALTER TABLE gst_rates
      ADD CONSTRAINT chk_gst_rate_range CHECK (rate >= 0 AND rate <= 100),
      ADD COLUMN cgst_rate numeric(5,2) GENERATED ALWAYS AS (rate / 2) STORED,
      ADD COLUMN sgst_rate numeric(5,2) GENERATED ALWAYS AS (rate / 2) STORED,
      ADD COLUMN igst_rate numeric(5,2) GENERATED ALWAYS AS (rate) STORED
  `);
  await knex.raw(updatedAtTrigger('gst_rates'));

  await knex.schema.createTable('products', (t) => {
    t.increments('id');
    t.string('name', 200).notNullable();
    t.string('sku', 60).notNullable();
    t.string('part_number', 80);
    t.integer('category_id').references('categories.id').onDelete('RESTRICT');
    t.integer('brand_id').references('brands.id').onDelete('RESTRICT');
    t.string('machine_model', 120);
    t.integer('unit_id').notNullable().references('units.id').onDelete('RESTRICT');
    t.string('hsn_code', 8);
    t.decimal('purchase_price', 14, 2).notNullable().defaultTo(0);
    t.decimal('selling_price', 14, 2).notNullable().defaultTo(0);
    t.decimal('mrp', 14, 2).notNullable().defaultTo(0);
    t.integer('gst_rate_id').references('gst_rates.id').onDelete('RESTRICT');
    t.decimal('min_stock_level', 14, 3).notNullable().defaultTo(0);
    t.text('description');
    t.boolean('is_active').notNullable().defaultTo(true);
    auditColumns(t);
    timestamps(knex, t);
  });
  await knex.raw(`
    ALTER TABLE products
      ADD CONSTRAINT chk_products_prices CHECK (purchase_price >= 0 AND selling_price >= 0 AND mrp >= 0),
      ADD CONSTRAINT chk_products_min_stock CHECK (min_stock_level >= 0),
      ADD CONSTRAINT chk_products_hsn CHECK (hsn_code IS NULL OR hsn_code ~ '^[0-9]{4,8}$')
  `);
  await knex.raw('CREATE UNIQUE INDEX uq_products_sku ON products (upper(sku))');
  await knex.raw('CREATE INDEX idx_products_category ON products (category_id)');
  await knex.raw('CREATE INDEX idx_products_brand ON products (brand_id)');
  // Trigram indexes power fast "contains" search from the mobile search screen.
  for (const col of ['name', 'sku', 'part_number', 'machine_model', 'hsn_code']) {
    await knex.raw(`CREATE INDEX idx_products_${col}_trgm ON products USING gin (${col} gin_trgm_ops)`);
  }
  await knex.raw(updatedAtTrigger('products'));
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('products');
  await knex.schema.dropTableIfExists('gst_rates');
  await knex.schema.dropTableIfExists('units');
  await knex.schema.dropTableIfExists('brands');
  await knex.schema.dropTableIfExists('categories');
}
