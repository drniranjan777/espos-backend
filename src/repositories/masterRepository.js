import { db } from '../config/database.js';

/**
 * Generic data access for small master tables (brands, units, GST rates, ...).
 *
 * @param {object} config
 * @param {string} config.table          table name
 * @param {Record<string,string>} config.fields  API field -> column mapping (writable + readable)
 * @param {Record<string,string|import('knex').Knex.Raw>} [config.readOnly] extra API field -> column/raw for reads
 * @param {string[]} config.searchColumns columns matched by ?search=
 * @param {string} config.orderBy         default ordering column
 * @param {(query: import('knex').Knex.QueryBuilder) => void} [config.decorate] adds joins for reads
 */
export function createMasterRepository(config) {
  const { table, fields, readOnly = {}, searchColumns, orderBy, decorate } = config;
  const alias = 'm';

  const selectColumns = [
    `${alias}.id`,
    ...Object.entries({ ...fields, ...readOnly }).map(([api, col]) =>
      typeof col === 'string' ? `${col.includes('.') ? col : `${alias}.${col}`} as ${api}` : col,
    ),
    `${alias}.created_at as createdAt`,
    `${alias}.updated_at as updatedAt`,
  ];

  function baseQuery(trx = db) {
    const query = trx(`${table} as ${alias}`).select(selectColumns);
    decorate?.(query);
    return query;
  }

  function toRow(data) {
    const row = {};
    for (const [api, col] of Object.entries(fields)) {
      if (data[api] !== undefined) row[col] = data[api];
    }
    return row;
  }

  return {
    table,

    async list({ search, isActive } = {}) {
      const query = baseQuery();
      if (isActive !== undefined) query.where(`${alias}.is_active`, isActive);
      if (search) {
        query.where((q) => {
          for (const col of searchColumns) q.orWhereILike(`${alias}.${col}`, `%${search}%`);
        });
      }
      return query.orderBy(`${alias}.${orderBy}`);
    },

    async findById(id, trx = db) {
      return (await baseQuery(trx).where(`${alias}.id`, id).first()) ?? null;
    },

    async create(data, userId, trx = db) {
      const [row] = await trx(table)
        .insert({ ...toRow(data), created_by: userId, updated_by: userId })
        .returning('id');
      return row.id;
    },

    async update(id, data, userId, trx = db) {
      await trx(table).where({ id }).update({ ...toRow(data), updated_by: userId });
    },

    async remove(id, trx = db) {
      await trx(table).where({ id }).del();
    },
  };
}
