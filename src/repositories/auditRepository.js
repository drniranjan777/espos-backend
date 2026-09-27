import { db } from '../config/database.js';
import { paginate } from '../utils/pagination.js';

export async function insert(entry, trx = db) {
  await trx('audit_logs').insert(entry);
}

export const AUDIT_SORT_FIELDS = { createdAt: 'a.created_at' };

export function list(filters) {
  const query = db('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.user_id')
    .select(
      'a.id',
      'a.action',
      'a.module',
      'a.record_id as recordId',
      'a.old_value as oldValue',
      'a.new_value as newValue',
      'a.ip',
      'a.user_agent as userAgent',
      'a.created_at as createdAt',
      'a.user_id as userId',
      'u.name as userName',
    );

  if (filters.module) query.where('a.module', filters.module);
  if (filters.action) query.where('a.action', filters.action);
  if (filters.userId) query.where('a.user_id', filters.userId);
  if (filters.recordId) query.where('a.record_id', filters.recordId);
  if (filters.from) query.where('a.created_at', '>=', filters.from);
  if (filters.to) query.whereRaw("a.created_at < (?::date + interval '1 day')", [filters.to]);

  return paginate(query, filters, AUDIT_SORT_FIELDS, 'a.id');
}
