/**
 * Reference data required in every environment. Idempotent: safe to run repeatedly,
 * never overwrites data an admin has edited.
 */
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import {
  ADMIN_ROLE_NAME,
  DEFAULT_ROLES,
  PERMISSION_DEFINITIONS,
} from '../constants/permissions.js';
import {
  DEFAULT_ADJUSTMENT_CODES,
  DEFAULT_GST_RATES,
  DEFAULT_UNITS,
  DEFAULT_WAREHOUSE,
} from '../constants/masterData.js';

async function insertMissing(knex, table, rows, matchColumn) {
  for (const row of rows) {
    const exists = await knex(table)
      .whereRaw(`lower(${matchColumn}::text) = lower(?)`, [String(row[matchColumn])])
      .first('id');
    if (!exists) await knex(table).insert(row);
  }
}

export async function seed(knex) {
  await knex.transaction(async (trx) => {
    const warehouse = await trx('warehouses').where({ is_default: true }).first('id');
    if (!warehouse) {
      await trx('warehouses').insert({ ...DEFAULT_WAREHOUSE, is_default: true });
    }

    await trx('permissions')
      .insert(PERMISSION_DEFINITIONS.map(([code, module, description]) => ({ code, module, description })))
      .onConflict('code')
      .merge(['module', 'description']);

    const permissionIds = Object.fromEntries(
      (await trx('permissions').select('id', 'code')).map((p) => [p.code, p.id]),
    );

    for (const role of DEFAULT_ROLES) {
      let existing = await trx('roles').where({ name: role.name }).first('id');
      const isNew = !existing;
      if (isNew) {
        [existing] = await trx('roles')
          .insert({ name: role.name, description: role.description, is_system: role.isSystem })
          .returning('id');
      }
      // Admin always gets every permission; other roles only get defaults on first creation
      // so later admin customisations are preserved.
      if (isNew || role.name === ADMIN_ROLE_NAME) {
        await trx('role_permissions')
          .insert(role.permissions.map((code) => ({ role_id: existing.id, permission_id: permissionIds[code] })))
          .onConflict(['role_id', 'permission_id'])
          .ignore();
      }
    }

    for (const rate of DEFAULT_GST_RATES) {
      await trx('gst_rates')
        .insert({ name: `GST ${rate}%`, rate })
        .onConflict('rate')
        .ignore();
    }

    await trx('adjustment_codes').insert(DEFAULT_ADJUSTMENT_CODES).onConflict('code').ignore();
    await insertMissing(trx, 'units', DEFAULT_UNITS, 'code');

    await trx('company_settings')
      .insert({ id: 1, company_name: 'My Company', invoice_prefix: 'INV', invoice_number_padding: 4 })
      .onConflict('id')
      .ignore();

    const adminRole = await trx('roles').where({ name: ADMIN_ROLE_NAME }).first('id');
    const admin = await trx('users').whereRaw('lower(username) = ?', ['admin']).first('id');
    if (!admin) {
      await trx('users').insert({
        name: 'Administrator',
        username: 'admin',
        email: 'admin@example.com',
        password_hash: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, env.BCRYPT_ROUNDS),
        role_id: adminRole.id,
      });
    }
  });
}
