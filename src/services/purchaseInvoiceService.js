import Decimal from 'decimal.js';
import { db } from '../config/database.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import * as purchaseInvoiceRepository from '../repositories/purchaseInvoiceRepository.js';
import { formatDocumentNo, nextSequenceNumber } from '../repositories/sequenceRepository.js';
import { ApiError } from '../utils/ApiError.js';
import { calculateInvoice, determineSupplyType, financialYear } from '../utils/gstCalculator.js';
import * as auditService from './auditService.js';

/**
 * Billing (purchase) invoices. One is created with every Stock IN, in the same database
 * transaction, from the purchase prices entered on its lines. Amounts are always
 * calculated here; nothing sent by the browser is trusted.
 */

export const PURCHASE_PREFIX = 'PI';

export function paymentStatusFor(paidAmount, grandTotal) {
  const paid = new Decimal(paidAmount);
  if (paid.gte(grandTotal)) return 'PAID';
  return paid.gt(0) ? 'PARTIAL' : 'UNPAID';
}

/**
 * Locks the products of a Stock IN and works out the price of every line: the price
 * entered, or the product's current purchase price when none was entered.
 *
 * @param {{ productId: number, quantity: number, purchasePrice?: number }[]} lines
 * @returns lines with `product`, `previousPrice` and `price` added
 */
export async function pricePurchaseLines(trx, lines) {
  const rows = await trx('products as p')
    .join('units as un', 'un.id', 'p.unit_id')
    .whereIn(
      'p.id',
      lines.map((l) => l.productId),
    )
    .orderBy('p.id')
    .forUpdate('p')
    .select(
      'p.id',
      'p.name',
      'p.sku',
      'p.part_number',
      'p.hsn_code',
      'p.purchase_price',
      'p.gst_rate_id',
      'un.code as unit_code',
    );
  const gstRates = new Map(
    (await trx('gst_rates').select('id', 'rate')).map((g) => [g.id, Number(g.rate)]),
  );
  const products = new Map(rows.map((p) => [p.id, p]));

  return lines.map((line) => {
    const product = products.get(line.productId);
    if (!product) throw ApiError.badRequest(`Product ${line.productId} does not exist`);
    const previousPrice = Number(product.purchase_price);
    return {
      ...line,
      product,
      gstRate: gstRates.get(product.gst_rate_id) ?? 0,
      previousPrice,
      price: line.purchasePrice ?? previousPrice,
    };
  });
}

/** Makes the entered price the product's current purchase price and keeps the history. */
async function updatePurchasePrices(trx, lines, movement, context) {
  for (const line of lines) {
    if (new Decimal(line.price).equals(line.previousPrice)) continue;
    await trx('products')
      .where({ id: line.productId })
      .update({ purchase_price: line.price, updated_by: context.userId });
    await trx('product_price_history').insert({
      product_id: line.productId,
      old_price: line.previousPrice,
      new_price: line.price,
      movement_id: movement.id,
      changed_by: context.userId,
    });
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.UPDATE,
        module: AUDIT_MODULE.PRODUCTS,
        recordId: line.productId,
        oldValue: { purchasePrice: line.previousPrice },
        newValue: { purchasePrice: line.price, stockIn: movement.movementNo },
        warehouseId: movement.warehouseId,
      },
      trx,
    );
  }
}

/**
 * Creates the billing invoice of a Stock IN and applies its price changes. Must run in
 * the Stock IN transaction, so stock, prices and invoice are saved together or not at all.
 *
 * @param {object} movement  { id, movementNo, warehouseId, date, noBill, invoiceNumber, note }
 * @param {object|null} supplier  customer row chosen on the Stock IN, if any
 * @param {string|null} supplierName  name as shown on the Stock IN
 * @param {object[]} lines  result of `pricePurchaseLines`
 * @returns {Promise<{ id: number, invoiceNo: string }>}
 */
export async function postForStockIn(trx, movement, supplier, supplierName, lines, context) {
  const company = await trx('company_settings').where({ id: 1 }).first('state_code');
  const supplyType = determineSupplyType(company?.state_code, supplier?.state_code);
  const { lines: priced, totals } = calculateInvoice(
    lines.map((line) => ({
      ...line,
      rate: line.price,
      // Stock received without a bill carries no input tax.
      gstRate: movement.noBill ? 0 : line.gstRate,
    })),
    supplyType,
  );

  const fy = financialYear(movement.date);
  const invoiceNo = formatDocumentNo(
    PURCHASE_PREFIX,
    fy,
    await nextSequenceNumber(PURCHASE_PREFIX, fy, trx),
  );

  const id = await purchaseInvoiceRepository.insert(
    {
      invoice_no: invoiceNo,
      movement_id: movement.id,
      warehouse_id: movement.warehouseId,
      invoice_date: movement.date,
      no_bill: movement.noBill,
      supplier_id: supplier?.id ?? null,
      supplier_name: supplierName,
      supplier_gstin: supplier?.gstin ?? null,
      supplier_state_code: supplier?.state_code ?? null,
      supplier_invoice_number: movement.invoiceNumber,
      supply_type: supplyType,
      subtotal: totals.subtotal,
      taxable_amount: totals.taxableAmount,
      cgst_amount: totals.cgstAmount,
      sgst_amount: totals.sgstAmount,
      igst_amount: totals.igstAmount,
      total_tax: totals.totalTax,
      round_off: totals.roundOff,
      grand_total: totals.grandTotal,
      paid_amount: 0,
      // Nothing to pay on a zero-value invoice.
      payment_status: paymentStatusFor(0, totals.grandTotal),
      notes: movement.note,
      created_by: context.userId,
      updated_by: context.userId,
    },
    priced.map((line, index) => ({
      line_no: index + 1,
      product_id: line.productId,
      product_name: line.product.name,
      sku: line.product.sku,
      part_number: line.product.part_number,
      hsn_code: line.product.hsn_code,
      unit: line.product.unit_code,
      quantity: line.quantity,
      previous_rate: line.previousPrice,
      rate: line.price,
      taxable_value: line.taxableValue,
      gst_rate: line.gstRate,
      cgst_rate: line.cgstRate,
      cgst_amount: line.cgstAmount,
      sgst_rate: line.sgstRate,
      sgst_amount: line.sgstAmount,
      igst_rate: line.igstRate,
      igst_amount: line.igstAmount,
      line_total: line.lineTotal,
    })),
    trx,
  );

  await updatePurchasePrices(trx, lines, movement, context);
  await auditService.log(
    context,
    {
      action: AUDIT_ACTION.CREATE,
      module: AUDIT_MODULE.PURCHASE_INVOICES,
      recordId: id,
      newValue: { invoiceNo, stockIn: movement.movementNo, grandTotal: totals.grandTotal },
      warehouseId: movement.warehouseId,
    },
    trx,
  );
  return { id, invoiceNo };
}

async function getOrThrow(id, warehouseId, trx) {
  const invoice = await purchaseInvoiceRepository.findById(id, trx);
  if (!invoice || invoice.warehouseId !== warehouseId) throw ApiError.notFound('Billing invoice');
  return invoice;
}

export const list = (filters, warehouseId) => purchaseInvoiceRepository.list(warehouseId, filters);
export const getById = (id, warehouseId) => getOrThrow(id, warehouseId);

/** Sets the total amount paid so far; the payment status follows from it. */
export async function recordPayment(id, paidAmount, context) {
  const { warehouseId } = context;
  return db.transaction(async (trx) => {
    const row = await purchaseInvoiceRepository.lockById(id, trx);
    if (!row || row.warehouse_id !== warehouseId) throw ApiError.notFound('Billing invoice');
    if (new Decimal(paidAmount).gt(row.grand_total)) {
      throw ApiError.validation([
        { field: 'paidAmount', message: 'Paid amount cannot be more than the invoice total' },
      ]);
    }
    const paymentStatus = paymentStatusFor(paidAmount, row.grand_total);
    await purchaseInvoiceRepository.setPayment(id, paidAmount, paymentStatus, context.userId, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.UPDATE,
        module: AUDIT_MODULE.PURCHASE_INVOICES,
        recordId: id,
        oldValue: { paidAmount: Number(row.paid_amount), paymentStatus: row.payment_status },
        newValue: { paidAmount, paymentStatus },
        warehouseId,
      },
      trx,
    );
    return getOrThrow(id, warehouseId, trx);
  });
}
