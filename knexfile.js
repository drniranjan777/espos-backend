import { env } from './src/config/env.js';

/** Shared knex configuration used by the app, the CLI and the test suite. */
const config = {
  client: 'pg',
  connection: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.dbName,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
  },
  pool: {
    min: env.DB_POOL_MIN,
    max: env.DB_POOL_MAX,
    // CURRENT_DATE / now()::date must follow the business timezone, not the server's.
    afterCreate: (conn, done) =>
      conn.query(`SET TIME ZONE '${env.APP_TIMEZONE}'`, (err) => done(err, conn)),
  },
  migrations: {
    directory: './src/migrations',
    tableName: 'knex_migrations',
    loadExtensions: ['.js'],
  },
  seeds: {
    directory: './src/seeders',
    loadExtensions: ['.js'],
  },
};

export default config;
