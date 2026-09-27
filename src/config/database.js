import knex from 'knex';
import pg from 'pg';
import config from '../../knexfile.js';

// NUMERIC columns are at most NUMERIC(14,3), which fits safely in a JS double, so return numbers.
// All arithmetic on money/quantities still goes through decimal.js in the services.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => (value === null ? null : Number(value)));
// COUNT(*) / SUM() of integers come back as BIGINT.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => (value === null ? null : Number(value)));
// Keep DATE columns as plain 'YYYY-MM-DD' strings to avoid timezone shifts.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const db = knex(config);

export async function checkDatabaseConnection() {
  await db.raw('select 1');
}

export async function closeDatabase() {
  await db.destroy();
}
