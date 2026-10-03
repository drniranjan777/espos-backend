/**
 * Rebuilds the test database from scratch once per test run: drops every object and runs
 * all migrations. (Rolling back is not always possible because the ledger is append-only.)
 */
export default async function setup() {
  process.env.NODE_ENV = 'test';
  const { db } = await import('../../src/config/database.js');
  await db.raw('DROP SCHEMA public CASCADE');
  await db.raw('CREATE SCHEMA public');
  await db.migrate.latest();
  await db.destroy();
}
