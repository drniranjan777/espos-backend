import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Builds a zod schema for list query params. `sortFields` maps public sort keys to
 * real column names so user input is never interpolated into SQL.
 */
export function listQuerySchema(sortFields, defaultSort, extra = {}) {
  const keys = Object.keys(sortFields);
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    search: z.string().trim().max(100).optional(),
    sortBy: z.enum(keys).default(defaultSort),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
    ...extra,
  });
}

/**
 * Applies ORDER BY / LIMIT / OFFSET and returns { items, total }.
 * `idColumn` is used as a tie-breaker so pages are stable when sort values repeat.
 */
export async function paginate(query, { page, limit, sortBy, sortOrder }, sortFields, idColumn) {
  const countQuery = query.clone().clearSelect().clearOrder().count({ total: '*' }).first();
  const [{ total }, items] = await Promise.all([
    countQuery.then((r) => r ?? { total: 0 }),
    query
      .orderBy([
        { column: sortFields[sortBy], order: sortOrder },
        { column: idColumn, order: sortOrder },
      ])
      .limit(limit)
      .offset((page - 1) * limit),
  ]);
  return { items, total: Number(total), page, limit };
}
