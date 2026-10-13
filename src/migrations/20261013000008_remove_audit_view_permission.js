/**
 * The audit log screen is gone, so nothing checks `audit.view` any more. Audit entries are
 * still recorded; role_permissions rows go with the permission (ON DELETE CASCADE).
 */
export async function up(knex) {
  await knex('permissions').where({ code: 'audit.view' }).del();
}

export async function down(knex) {
  await knex('permissions')
    .insert({ code: 'audit.view', module: 'administration', description: 'View audit logs' })
    .onConflict('code')
    .ignore();
}
