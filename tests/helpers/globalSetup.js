/** Rebuilds the test database schema once per test run. */
export default async function setup() {
  process.env.NODE_ENV = 'test';
  const { db } = await import('../../src/config/database.js');
  await db.migrate.rollback(undefined, true);
  await db.migrate.latest();
  await db.destroy();
}
