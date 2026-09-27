import { db } from '../config/database.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import { STATE_NAME_BY_CODE } from '../constants/masterData.js';
import { TXN_TYPE } from '../constants/transactionTypes.js';
import * as invoiceRepository from '../repositories/invoiceRepository.js';
import * as settingsRepository from '../repositories/settingsRepository.js';
import { getDefaultWarehouseId } from '../repositories/warehouseRepository.js';
import { ApiError } from '../utils/ApiError.js';
import {
  calculateInvoice,
  determineSupplyType,
  financialYear,
  hsnSummary,
} from '../utils/gstCalculator.js';
import { amountInWords } from '../utils/numberToWords.js';
import * as auditService from './auditService.js';
import { applyMovement } from './inventoryService.js';
import { getSettings } from './settingsService.js';

export const INVOICE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  FINAL: 'FINAL',
  CANCELLED: 'CANCELLED',
});
const REFERENCE_TYPE = 'INVOICE';

async function getOrThrow(id, trx) {
  const invoice = await invoiceRepository.findById(id, trx);
  if (!invoice) throw ApiError.notFound('Invoice');
  return invoice;
}

async function loadCustomer(trx, customerId) {
  const customer = await trx('customers').where({ id: customerId }).first();
  if (!customer) throw ApiError.badRequest('Selected customer does not exist');
  if (!customer.is_active) throw ApiError.badRequest('Selected customer is inactive');
  return customer;
}

/** Loads products for the given items, keyed by id, including their current GST rate. */
async function loadProducts(trx, productIds) {
  const rows = await trx('products as p')
    .join('units as un', 'un.id', 'p.unit_id')
    .leftJoin('gst_rates as g', 'g.id', 'p.gst_rate_id')
    .whereIn('p.id', productIds)
    .select(
      'p.id',
      'p.name',
      'p.sku',
      'p.part_number',
      'p.hsn_code',
      'p.selling_price',
      'p.is_active',
      'un.code as unit_code',
      'g.rate as gst_rate',
    );
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Builds item rows and header totals from the request. Product names, HSN, unit and GST
 * rate always come from the product master; totals are always computed on the server.
 */
async function buildInvoiceData(trx, payload, companyStateCode) {
  const customer = await loadCustomer(trx, payload.customerId);
  const products = await loadProducts(trx, [...new Set(payload.items.map((i) => i.productId))]);

  const inputs = payload.items.map((item, index) => {
    const product = products.get(item.productId);
    if (!product) throw ApiError.badRequest(`Line ${index + 1}: product does not exist`);
    if (!product.is_active) {
      throw ApiError.badRequest(`Line ${index + 1}: ${product.name} is inactive`);
    }
    return {
      product,
      quantity: item.quantity,
      rate: item.rate ?? product.selling_price,
      discountPercent: item.discountPercent ?? 0,
      gstRate: product.gst_rate ?? 0,
      hsnCode: product.hsn_code,
    };
  });

  const placeOfSupply =
    payload.placeOfSupplyStateCode ?? customer.state_code ?? companyStateCode ?? null;
  const supplyType = determineSupplyType(companyStateCode, placeOfSupply);
  const { lines, totals } = calculateInvoice(inputs, supplyType);

  const items = lines.map((line, index) => ({
    line_no: index + 1,
    product_id: line.product.id,
    product_name: line.product.name,
    sku: line.product.sku,
    part_number: line.product.part_number,
    hsn_code: line.product.hsn_code,
    unit: line.product.unit_code,
    quantity: line.quantity,
    rate: line.rate,
    discount_percent: line.discountPercent,
    discount_amount: line.discountAmount,
    taxable_value: line.taxableValue,
    gst_rate: line.gstRate,
    cgst_rate: line.cgstRate,
    cgst_amount: line.cgstAmount,
    sgst_rate: line.sgstRate,
    sgst_amount: line.sgstAmount,
    igst_rate: line.igstRate,
    igst_amount: line.igstAmount,
    line_total: line.lineTotal,
  }));

  const header = {
    invoice_date: payload.invoiceDate,
    customer_id: customer.id,
    customer_name: customer.name,
    customer_company_name: customer.company_name,
    customer_gstin: customer.gstin,
    customer_mobile: customer.mobile,
    customer_email: customer.email,
    billing_address: customer.billing_address,
    shipping_address:
      payload.shippingAddress ?? customer.shipping_address ?? customer.billing_address,
    customer_state: customer.state,
    customer_state_code: customer.state_code,
    place_of_supply_state_code: placeOfSupply,
    supply_type: supplyType,
    subtotal: totals.subtotal,
    total_discount: totals.totalDiscount,
    taxable_amount: totals.taxableAmount,
    cgst_amount: totals.cgstAmount,
    sgst_amount: totals.sgstAmount,
    igst_amount: totals.igstAmount,
    total_tax: totals.totalTax,
    round_off: totals.roundOff,
    grand_total: totals.grandTotal,
    notes: payload.notes ?? null,
  };

  return { header, items };
}

/** Company details as printed on the invoice at the moment it is finalized. */
const NON_PRINTED_SETTINGS = ['invoicePrefix', 'invoiceNumberPadding', 'updatedAt'];

function companySnapshot(settings) {
  const company = Object.fromEntries(
    Object.entries(settings).filter(([key]) => !NON_PRINTED_SETTINGS.includes(key)),
  );
  return JSON.stringify(company);
}

function formatInvoiceNo(prefix, fy, number, padding) {
  return `${prefix}/${fy}/${String(number).padStart(padding, '0')}`;
}

/** Assigns a number, deducts stock and freezes company details. Caller holds the row lock. */
async function finalizeLocked(trx, id, context) {
  const settings = await settingsRepository.get(trx);
  if (!settings.stateCode) {
    throw ApiError.badRequest('Set the company state in Settings before finalizing invoices');
  }

  // Re-read customer details and recompute so the issued invoice reflects current masters.
  const draft = await getOrThrow(id, trx);
  const { header, items } = await buildInvoiceData(
    trx,
    {
      customerId: draft.customerId,
      invoiceDate: draft.invoiceDate,
      placeOfSupplyStateCode: draft.placeOfSupplyStateCode,
      shippingAddress: draft.shippingAddress,
      notes: draft.notes,
      items: draft.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        rate: i.rate,
        discountPercent: i.discountPercent,
      })),
    },
    settings.stateCode,
  );

  const fy = financialYear(draft.invoiceDate);
  const number = await invoiceRepository.nextSequenceNumber(settings.invoicePrefix, fy, trx);
  const invoiceNo = formatInvoiceNo(
    settings.invoicePrefix,
    fy,
    number,
    settings.invoiceNumberPadding,
  );

  await invoiceRepository.replaceItems(id, items, trx);
  await invoiceRepository.updateHeader(
    id,
    {
      ...header,
      invoice_no: invoiceNo,
      status: INVOICE_STATUS.FINAL,
      company_snapshot: companySnapshot(settings),
      finalized_at: trx.fn.now(),
      finalized_by: context.userId,
      updated_by: context.userId,
    },
    trx,
  );

  // Lock stock rows in a consistent (product id) order to avoid deadlocks between invoices.
  const warehouseId = await getDefaultWarehouseId(trx);
  const sorted = [...items].sort((a, b) => a.product_id - b.product_id || a.line_no - b.line_no);
  for (const item of sorted) {
    await applyMovement(
      trx,
      {
        productId: item.product_id,
        warehouseId,
        type: TXN_TYPE.INVOICE_OUT,
        quantity: item.quantity,
        unitPrice: item.rate,
        customerId: header.customer_id,
        referenceType: REFERENCE_TYPE,
        referenceId: id,
        referenceNo: invoiceNo,
        txnDate: draft.invoiceDate,
      },
      context,
    );
  }

  const finalized = await getOrThrow(id, trx);
  await auditService.log(
    context,
    {
      action: AUDIT_ACTION.FINALIZE,
      module: AUDIT_MODULE.INVOICES,
      recordId: id,
      newValue: finalized,
    },
    trx,
  );
  return finalized;
}

export const list = (filters) => invoiceRepository.list(filters);

/** Invoice with computed print data (HSN summary, amount in words, company details). */
export async function getById(id) {
  const invoice = await getOrThrow(id);
  const company = invoice.companySnapshot ?? (await getSettings());
  return {
    ...invoice,
    company,
    placeOfSupplyState: STATE_NAME_BY_CODE[invoice.placeOfSupplyStateCode] ?? null,
    hsnSummary: hsnSummary(invoice.items),
    amountInWords: amountInWords(invoice.grandTotal),
  };
}

export async function create({ finalize, ...payload }, context) {
  return db.transaction(async (trx) => {
    const settings = await settingsRepository.get(trx);
    const { header, items } = await buildInvoiceData(trx, payload, settings.stateCode);
    const id = await invoiceRepository.insertHeader(
      {
        ...header,
        status: INVOICE_STATUS.DRAFT,
        warehouse_id: await getDefaultWarehouseId(trx),
        created_by: context.userId,
        updated_by: context.userId,
      },
      trx,
    );
    await invoiceRepository.replaceItems(id, items, trx);
    const draft = await getOrThrow(id, trx);
    await auditService.log(
      context,
      { action: AUDIT_ACTION.CREATE, module: AUDIT_MODULE.INVOICES, recordId: id, newValue: draft },
      trx,
    );

    if (!finalize) return draft;
    await invoiceRepository.lockById(id, trx);
    return finalizeLocked(trx, id, context);
  });
}

export async function update(id, payload, context) {
  return db.transaction(async (trx) => {
    const locked = await invoiceRepository.lockById(id, trx);
    if (!locked) throw ApiError.notFound('Invoice');
    if (locked.status !== INVOICE_STATUS.DRAFT) {
      throw ApiError.conflict('Only draft invoices can be edited', 'INVOICE_NOT_EDITABLE');
    }
    const before = await getOrThrow(id, trx);
    const settings = await settingsRepository.get(trx);
    const { header, items } = await buildInvoiceData(trx, payload, settings.stateCode);
    await invoiceRepository.updateHeader(id, { ...header, updated_by: context.userId }, trx);
    await invoiceRepository.replaceItems(id, items, trx);
    const after = await getOrThrow(id, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.UPDATE,
        module: AUDIT_MODULE.INVOICES,
        recordId: id,
        oldValue: before,
        newValue: after,
      },
      trx,
    );
    return after;
  });
}

export async function finalize(id, context) {
  return db.transaction(async (trx) => {
    const locked = await invoiceRepository.lockById(id, trx);
    if (!locked) throw ApiError.notFound('Invoice');
    if (locked.status !== INVOICE_STATUS.DRAFT) {
      throw ApiError.conflict('This invoice is already finalized', 'INVOICE_NOT_DRAFT');
    }
    return finalizeLocked(trx, id, context);
  });
}

/** Cancels a finalized invoice and returns its stock. The number is kept (never reused). */
export async function cancel(id, { reason }, context) {
  return db.transaction(async (trx) => {
    const locked = await invoiceRepository.lockById(id, trx);
    if (!locked) throw ApiError.notFound('Invoice');
    if (locked.status === INVOICE_STATUS.CANCELLED) {
      throw ApiError.conflict('This invoice is already cancelled', 'INVOICE_ALREADY_CANCELLED');
    }
    if (locked.status === INVOICE_STATUS.DRAFT) {
      throw ApiError.conflict(
        'Draft invoices can be deleted instead of cancelled',
        'INVOICE_IS_DRAFT',
      );
    }

    const invoice = await getOrThrow(id, trx);
    const warehouseId = await getDefaultWarehouseId(trx);
    const sorted = [...invoice.items].sort(
      (a, b) => a.productId - b.productId || a.lineNo - b.lineNo,
    );
    for (const item of sorted) {
      await applyMovement(
        trx,
        {
          productId: item.productId,
          warehouseId,
          type: TXN_TYPE.INVOICE_CANCEL,
          quantity: item.quantity,
          unitPrice: item.rate,
          customerId: invoice.customerId,
          referenceType: REFERENCE_TYPE,
          referenceId: id,
          referenceNo: invoice.invoiceNo,
          reason: `Invoice cancelled: ${reason}`,
          requireActiveProduct: false,
        },
        context,
      );
    }

    await invoiceRepository.updateHeader(
      id,
      {
        status: INVOICE_STATUS.CANCELLED,
        cancelled_at: trx.fn.now(),
        cancelled_by: context.userId,
        cancel_reason: reason,
        updated_by: context.userId,
      },
      trx,
    );
    const after = await getOrThrow(id, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.CANCEL,
        module: AUDIT_MODULE.INVOICES,
        recordId: id,
        oldValue: { status: invoice.status },
        newValue: { status: after.status, reason },
      },
      trx,
    );
    return after;
  });
}

export async function removeDraft(id, context) {
  return db.transaction(async (trx) => {
    const locked = await invoiceRepository.lockById(id, trx);
    if (!locked) throw ApiError.notFound('Invoice');
    if (locked.status !== INVOICE_STATUS.DRAFT) {
      throw ApiError.conflict(
        'Only draft invoices can be deleted. Cancel finalized invoices instead.',
        'INVOICE_NOT_DRAFT',
      );
    }
    const before = await getOrThrow(id, trx);
    await invoiceRepository.remove(id, trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.DELETE,
        module: AUDIT_MODULE.INVOICES,
        recordId: id,
        oldValue: before,
      },
      trx,
    );
  });
}
