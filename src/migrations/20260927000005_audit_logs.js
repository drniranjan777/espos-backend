/**
 * Audit trail for create/update/delete and inventory actions.
 */
export async function up(knex) {
  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id');
    t.integer('user_id').references('users.id').onDelete('SET NULL');
    t.string('action', 40).notNullable();
    t.string('module', 40).notNullable();
    t.string('record_id', 50);
    t.jsonb('old_value');
    t.jsonb('new_value');
    t.string('ip', 64);
    t.string('user_agent', 255);
    t.integer('warehouse_id').references('warehouses.id').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['module', 'record_id']);
    t.index(['user_id', 'created_at']);
    t.index(['created_at']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('audit_logs');
}
