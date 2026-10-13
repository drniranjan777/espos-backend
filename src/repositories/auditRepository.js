import { db } from '../config/database.js';

export async function insert(entry, trx = db) {
  await trx('audit_logs').insert(entry);
}
