/**
 * Foundation: extensions, shared trigger functions, warehouses, RBAC, users and refresh tokens.
 */
import { timestamps, updatedAtTrigger } from '../utils/migrationHelpers.js';

export async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Phase 1 runs with a single DEFAULT warehouse; the table exists now so Phase 2
  // can add more warehouses without redesigning stock tables.
  await knex.schema.createTable('warehouses', (t) => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.string('name', 150).notNullable();
    t.text('address');
    t.string('state', 100);
    t.string('state_code', 2);
    t.boolean('is_default').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    timestamps(knex, t);
  });
  await knex.raw(
    'CREATE UNIQUE INDEX uq_warehouses_single_default ON warehouses (is_default) WHERE is_default',
  );
  await knex.raw(updatedAtTrigger('warehouses'));

  await knex.schema.createTable('roles', (t) => {
    t.increments('id');
    t.string('name', 50).notNullable().unique();
    t.string('description', 255);
    // System roles (e.g. Admin) cannot be deleted or renamed.
    t.boolean('is_system').notNullable().defaultTo(false);
    timestamps(knex, t);
  });
  await knex.raw(updatedAtTrigger('roles'));

  await knex.schema.createTable('permissions', (t) => {
    t.increments('id');
    t.string('code', 60).notNullable().unique();
    t.string('module', 40).notNullable();
    t.string('description', 255).notNullable();
  });

  await knex.schema.createTable('role_permissions', (t) => {
    t.integer('role_id').notNullable().references('roles.id').onDelete('CASCADE');
    t.integer('permission_id').notNullable().references('permissions.id').onDelete('CASCADE');
    t.primary(['role_id', 'permission_id']);
  });

  await knex.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('username', 50).notNullable();
    t.string('email', 150);
    t.string('mobile', 15);
    t.string('password_hash', 255).notNullable();
    t.integer('role_id').notNullable().references('roles.id').onDelete('RESTRICT');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('last_login_at', { useTz: true });
    t.integer('created_by').references('users.id').onDelete('SET NULL');
    t.integer('updated_by').references('users.id').onDelete('SET NULL');
    timestamps(knex, t);
  });
  await knex.raw('CREATE UNIQUE INDEX uq_users_username ON users (lower(username))');
  await knex.raw(
    'CREATE UNIQUE INDEX uq_users_email ON users (lower(email)) WHERE email IS NOT NULL',
  );
  await knex.raw(updatedAtTrigger('users'));

  await knex.schema.createTable('refresh_tokens', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('token_hash', 128).notNullable().unique();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('revoked_at', { useTz: true });
    t.string('ip', 64);
    t.string('user_agent', 255);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('roles');
  await knex.schema.dropTableIfExists('warehouses');
  await knex.raw('DROP FUNCTION IF EXISTS set_updated_at()');
}
