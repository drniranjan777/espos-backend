import { db } from '../config/database.js';

export async function create(data, trx = db) {
  await trx('refresh_tokens').insert(data);
}

export async function findByHash(tokenHash, trx = db) {
  return (await trx('refresh_tokens').where({ token_hash: tokenHash }).forUpdate().first()) ?? null;
}

export async function revoke(id, trx = db) {
  await trx('refresh_tokens').where({ id }).whereNull('revoked_at').update({ revoked_at: db.fn.now() });
}

export async function revokeAllForUser(userId, trx = db) {
  await trx('refresh_tokens')
    .where({ user_id: userId })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now() });
}

/** Housekeeping: drop tokens that expired more than a day ago. */
export async function deleteExpired() {
  await db('refresh_tokens').where('expires_at', '<', db.raw("now() - interval '1 day'")).del();
}
