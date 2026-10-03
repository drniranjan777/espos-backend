/**
 * Gap-free document counters per prefix + financial year (invoices, stock movements,
 * transfers). The counter row is updated in the caller's transaction, so a rolled-back
 * document never consumes a number.
 */
export async function nextSequenceNumber(prefix, financialYear, trx) {
  await trx('invoice_sequences')
    .insert({ prefix, financial_year: financialYear, last_number: 0 })
    .onConflict(['prefix', 'financial_year'])
    .ignore();
  const [row] = await trx('invoice_sequences')
    .where({ prefix, financial_year: financialYear })
    .increment('last_number', 1)
    .returning('last_number');
  return row.last_number;
}

export function formatDocumentNo(prefix, financialYear, number, padding = 4) {
  return `${prefix}/${financialYear}/${String(number).padStart(padding, '0')}`;
}
