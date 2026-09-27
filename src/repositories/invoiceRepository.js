import { db } from '../config/database.js';
import { paginate } from '../utils/pagination.js';

const HEADER_COLUMNS = [
  'i.id',
  'i.invoice_no as invoiceNo',
  'i.invoice_date as invoiceDate',
  'i.status',
  'i.customer_id as customerId',
  'i.customer_name as customerName',
  'i.customer_company_name as customerCompanyName',
  'i.customer_gstin as customerGstin',
  'i.customer_mobile as customerMobile',
  'i.customer_email as customerEmail',
  'i.billing_address as billingAddress',
  'i.shipping_address as shippingAddress',
  'i.customer_state as customerState',
  'i.customer_state_code as customerStateCode',
  'i.place_of_supply_state_code as placeOfSupplyStateCode',
  'i.supply_type as supplyType',
  'i.subtotal',
  'i.total_discount as totalDiscount',
  'i.taxable_amount as taxableAmount',
  'i.cgst_amount as cgstAmount',
  'i.sgst_amount as sgstAmount',
  'i.igst_amount as igstAmount',
  'i.total_tax as totalTax',
  'i.round_off as roundOff',
  'i.grand_total as grandTotal',
  'i.notes',
  'i.company_snapshot as companySnapshot',
  'i.finalized_at as finalizedAt',
  'i.cancelled_at as cancelledAt',
  'i.cancel_reason as cancelReason',
  'i.created_at as createdAt',
  'i.updated_at as updatedAt',
  'cu.name as createdByName',
];

const LIST_COLUMNS = [
  'i.id',
  'i.invoice_no as invoiceNo',
  'i.invoice_date as invoiceDate',
  'i.status',
  'i.customer_id as customerId',
  'i.customer_name as customerName',
  'i.customer_company_name as customerCompanyName',
  'i.customer_gstin as customerGstin',
  'i.grand_total as grandTotal',
  'i.created_at as createdAt',
  db.raw('(SELECT count(*) FROM invoice_items ii WHERE ii.invoice_id = i.id)::int as "itemCount"'),
];

const ITEM_COLUMNS = [
  'id',
  'line_no as lineNo',
  'product_id as productId',
  'product_name as productName',
  'sku',
  'part_number as partNumber',
  'hsn_code as hsnCode',
  'unit',
  'quantity',
  'rate',
  'discount_percent as discountPercent',
  'discount_amount as discountAmount',
  'taxable_value as taxableValue',
  'gst_rate as gstRate',
  'cgst_rate as cgstRate',
  'cgst_amount as cgstAmount',
  'sgst_rate as sgstRate',
  'sgst_amount as sgstAmount',
  'igst_rate as igstRate',
  'igst_amount as igstAmount',
  'line_total as lineTotal',
];

export const INVOICE_SORT_FIELDS = {
  invoiceDate: 'i.invoice_date',
  invoiceNo: 'i.invoice_no',
  grandTotal: 'i.grand_total',
  createdAt: 'i.created_at',
};

export function list(filters) {
  const query = db('invoices as i').select(LIST_COLUMNS);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query.where((q) =>
      q
        .whereILike('i.invoice_no', term)
        .orWhereILike('i.customer_name', term)
        .orWhereILike('i.customer_company_name', term)
        .orWhereILike('i.customer_gstin', term)
        .orWhereILike('i.customer_mobile', term),
    );
  }
  if (filters.status) query.where('i.status', filters.status);
  if (filters.customerId) query.where('i.customer_id', filters.customerId);
  if (filters.from) query.where('i.invoice_date', '>=', filters.from);
  if (filters.to) query.where('i.invoice_date', '<=', filters.to);
  return paginate(query, filters, INVOICE_SORT_FIELDS, 'i.id');
}

export async function findById(id, trx = db) {
  const invoice = await trx('invoices as i')
    .leftJoin('users as cu', 'cu.id', 'i.created_by')
    .where('i.id', id)
    .first(HEADER_COLUMNS);
  if (!invoice) return null;
  invoice.items = await trx('invoice_items')
    .where({ invoice_id: id })
    .select(ITEM_COLUMNS)
    .orderBy('line_no');
  return invoice;
}

/** Locks the invoice row for the rest of the transaction (prevents double finalize/cancel). */
export async function lockById(id, trx) {
  return (
    (await trx('invoices').where({ id }).forUpdate().first('id', 'status', 'invoice_no')) ?? null
  );
}

export async function insertHeader(data, trx) {
  const [row] = await trx('invoices').insert(data).returning('id');
  return row.id;
}

export async function updateHeader(id, data, trx) {
  await trx('invoices').where({ id }).update(data);
}

export async function replaceItems(invoiceId, items, trx) {
  await trx('invoice_items').where({ invoice_id: invoiceId }).del();
  if (items.length) {
    await trx('invoice_items').insert(items.map((item) => ({ ...item, invoice_id: invoiceId })));
  }
}

export async function remove(id, trx) {
  await trx('invoices').where({ id }).del();
}

/** Allocates the next gap-free number for a prefix + financial year under a row lock. */
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
