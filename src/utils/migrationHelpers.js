/** Shared helpers for knex migrations. Kept outside the migrations folder so knex doesn't load it. */

/** Adds created_at / updated_at columns. Pair with `updatedAtTrigger` to keep updated_at fresh. */
export function timestamps(knex, table) {
  table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
}

/** Adds created_by / updated_by user references. */
export function auditColumns(table) {
  table.integer('created_by').references('users.id').onDelete('SET NULL');
  table.integer('updated_by').references('users.id').onDelete('SET NULL');
}

export function updatedAtTrigger(tableName) {
  return `CREATE TRIGGER trg_${tableName}_updated_at BEFORE UPDATE ON ${tableName}
          FOR EACH ROW EXECUTE FUNCTION set_updated_at();`;
}
