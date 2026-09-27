import { db } from '../../src/config/database.js';

/** Empties every table and re-runs the seeds so each test file starts from known data. */
export async function resetDatabase() {
  const { rows } = await db.raw(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE 'knex_migrations%'
  `);
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  // TRUNCATE does not fire the ledger's row-level immutability trigger.
  await db.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  await db.seed.run();
}

export { db };
