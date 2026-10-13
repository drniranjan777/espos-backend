import { db } from '../config/database.js';
import { paginate } from '../utils/pagination.js';

const LIST_COLUMNS = [
  'pi.id',
  'pi.invoice_no as invoiceNo',
  'pi.invoice_date as invoiceDate',
  'pi.status',
  'pi.no_bill as noBill',
  'pi.warehouse_id as warehouseId',
  'pi.supplier_id as supplierId',
  'pi.supplier_name as supplierName',
  'pi.supplier_invoice_number as supplierInvoiceNumber',
  'pi.movement_id as movementId',
  'm.movement_no as movementNo',
  'pi.grand_total as grandTotal',
  'pi.paid_amount as paidAmount',
  db.raw('(pi.grand_total - pi.paid_amount)::numeric(14,2) as "outstandingAmount"'),
  'pi.payment_status as paymentStatus',
  'pi.created_at as createdAt',
];

const HEADER_COLUMNS = [
  ...LIST_COLUMNS,
  'w.name as branchName',
  'pi.supplier_gstin as supplierGstin',
  'pi.supplier_state_code as supplierStateCode',
  'pi.supply_type as supplyType',
  'pi.subtotal',
  'pi.taxable_amount as taxableAmount',
  'pi.cgst_amount as cgstAmount',
  'pi.sgst_amount as sgstAmount',
  'pi.igst_amount as igstAmount',
  'pi.total_tax as totalTax',
  'pi.round_off as roundOff',
  'pi.notes',
  'pi.updated_at as updatedAt',
  'u.name as createdByName',
];

const ITEM_COLUMNS = [
  'line_no as lineNo',
  'product_id as productId',
  'product_name as productName',
  'sku',
  'part_number as partNumber',
  'hsn_code as hsnCode',
  'unit',
  'quantity',
  'previous_rate as previousRate',
  'rate',
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

function baseQuery(trx = db) {
  return trx('purchase_invoices as pi')
    .join('stock_movements as m', 'm.id', 'pi.movement_id')
    .join('warehouses as w', 'w.id', 'pi.warehouse_id')
    .leftJoin('users as u', 'u.id', 'pi.created_by');
}

export async function insert(header, items, trx) {
  const [row] = await trx('purchase_invoices').insert(header).returning('id');
  await trx('purchase_invoice_items').insert(
    items.map((item) => ({ ...item, purchase_invoice_id: row.id })),
  );
  return row.id;
}

export async function findById(id, trx = db) {
  const invoice = await baseQuery(trx).where('pi.id', id).first(HEADER_COLUMNS);
  if (!invoice) return null;
  invoice.items = await trx('purchase_invoice_items')
    .where({ purchase_invoice_id: id })
    .orderBy('line_no')
    .select(ITEM_COLUMNS);
  return invoice;
}

/** Locks the invoice row for a payment update. */
export function lockById(id, trx) {
  return trx('purchase_invoices')
    .where({ id })
    .forUpdate()
    .first('id', 'warehouse_id', 'status', 'grand_total', 'paid_amount', 'payment_status');
}

export async function setPayment(id, paidAmount, paymentStatus, userId, trx) {
  await trx('purchase_invoices')
    .where({ id })
    .update({ paid_amount: paidAmount, payment_status: paymentStatus, updated_by: userId });
}

export const PURCHASE_INVOICE_SORT_FIELDS = {
  createdAt: 'pi.id',
  invoiceDate: 'pi.invoice_date',
  grandTotal: 'pi.grand_total',
};

export function list(warehouseId, filters) {
  const query = baseQuery().select(LIST_COLUMNS).where('pi.warehouse_id', warehouseId);
  if (filters.from) query.where('pi.invoice_date', '>=', filters.from);
  if (filters.to) query.where('pi.invoice_date', '<=', filters.to);
  if (filters.paymentStatus) query.where('pi.payment_status', filters.paymentStatus);
  if (filters.supplierId) query.where('pi.supplier_id', filters.supplierId);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query.where((q) =>
      q
        .whereILike('pi.invoice_no', term)
        .orWhereILike('pi.supplier_name', term)
        .orWhereILike('pi.supplier_invoice_number', term)
        .orWhereILike('m.movement_no', term),
    );
  }
  return paginate(query, filters, PURCHASE_INVOICE_SORT_FIELDS, 'pi.id');
}
