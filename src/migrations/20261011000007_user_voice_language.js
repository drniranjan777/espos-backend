/**
 * Language a user speaks to Ask Stock and voice search ('en', 'hi', 'te'), so the choice
 * follows them across devices.
 */
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('voice_language', 8);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('voice_language');
  });
}
