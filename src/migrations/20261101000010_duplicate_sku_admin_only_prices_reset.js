/**
 * - Several products may share one SKU / part code: the unique index on products.sku becomes a
 *   plain index (search still uses it). Products keep their own unique id.
 * - Date-wise Stock IN / OUT history filters by movement_date, so it gets an index.
 * - Purchase prices and billing invoices are Admin-only: the purchase.* permissions are taken away
 *   from every non-system role (the API also filters them, see userRepository).
 * - New Admin-only permission data.reset for the Reset Everything screen.
 */
import {
  ADMIN_ONLY_PERMISSIONS,
  PERMISSION_DEFINITIONS,
} from '../constants/permissions.js';

export async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS uq_products_sku');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_products_sku_upper ON products (upper(sku))');

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements (warehouse_id, movement_date)',
  );

  const added = PERMISSION_DEFINITIONS.filter(([code]) => code === 'data.reset');
  await knex('permissions')
    .insert(added.map(([code, module, description]) => ({ code, module, description })))
    .onConflict('code')
    .ignore();
  // Keep the descriptions of the purchase permissions current.
  for (const [code, , description] of PERMISSION_DEFINITIONS) {
    if (ADMIN_ONLY_PERMISSIONS.includes(code)) {
      await knex('permissions').where({ code }).update({ description });
    }
  }
  await knex.raw(
    `
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.is_system AND p.code = ANY(?)
    ON CONFLICT DO NOTHING
  `,
    [ADMIN_ONLY_PERMISSIONS],
  );
  await knex.raw(
    `
    DELETE FROM role_permissions rp
    USING roles r, permissions p
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
      AND NOT r.is_system AND p.code = ANY(?)
  `,
    [ADMIN_ONLY_PERMISSIONS],
  );
}

export async function down(knex) {
  const { rows } = await knex.raw(
    'SELECT upper(sku) AS sku FROM products GROUP BY upper(sku) HAVING count(*) > 1 LIMIT 1',
  );
  if (rows.length) {
    throw new Error(
      `Cannot roll back: several products share the SKU ${rows[0].sku}. Give them different SKUs first.`,
    );
  }
  await knex.raw('DROP INDEX IF EXISTS idx_products_sku_upper');
  await knex.raw('CREATE UNIQUE INDEX uq_products_sku ON products (upper(sku))');
  await knex.raw('DROP INDEX IF EXISTS idx_stock_movements_date');
  await knex('permissions').where({ code: 'data.reset' }).del();
}
