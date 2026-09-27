import Decimal from 'decimal.js';

export const SUPPLY_TYPE = Object.freeze({ INTRA: 'INTRA', INTER: 'INTER' });

const round2 = (value) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * Same state (supplier state == place of supply): CGST + SGST. Different state: IGST.
 * When either state is unknown the sale is treated as intra-state.
 */
export function determineSupplyType(companyStateCode, placeOfSupplyStateCode) {
  if (!companyStateCode || !placeOfSupplyStateCode) return SUPPLY_TYPE.INTRA;
  return companyStateCode === placeOfSupplyStateCode ? SUPPLY_TYPE.INTRA : SUPPLY_TYPE.INTER;
}

/**
 * Calculates one invoice line. Tax is computed per line on the taxable value
 * (after discount) and rounded to paise.
 *
 * @param {{ quantity: number|string, rate: number|string, discountPercent?: number|string, gstRate: number|string }} item
 * @param {'INTRA'|'INTER'} supplyType
 */
export function calculateLine(item, supplyType) {
  const quantity = new Decimal(item.quantity);
  const rate = new Decimal(item.rate);
  const discountPercent = new Decimal(item.discountPercent ?? 0);
  const gstRate = new Decimal(item.gstRate ?? 0);

  const gross = round2(quantity.times(rate));
  const discountAmount = round2(gross.times(discountPercent).dividedBy(100));
  const taxableValue = gross.minus(discountAmount);

  let cgstRate = new Decimal(0);
  let sgstRate = new Decimal(0);
  let igstRate = new Decimal(0);
  if (supplyType === SUPPLY_TYPE.INTER) {
    igstRate = gstRate;
  } else {
    cgstRate = gstRate.dividedBy(2);
    sgstRate = gstRate.dividedBy(2);
  }

  const cgstAmount = round2(taxableValue.times(cgstRate).dividedBy(100));
  const sgstAmount = round2(taxableValue.times(sgstRate).dividedBy(100));
  const igstAmount = round2(taxableValue.times(igstRate).dividedBy(100));
  const lineTotal = taxableValue.plus(cgstAmount).plus(sgstAmount).plus(igstAmount);

  return {
    grossAmount: gross.toNumber(),
    discountAmount: discountAmount.toNumber(),
    taxableValue: taxableValue.toNumber(),
    gstRate: gstRate.toNumber(),
    cgstRate: cgstRate.toNumber(),
    cgstAmount: cgstAmount.toNumber(),
    sgstRate: sgstRate.toNumber(),
    sgstAmount: sgstAmount.toNumber(),
    igstRate: igstRate.toNumber(),
    igstAmount: igstAmount.toNumber(),
    lineTotal: lineTotal.toNumber(),
  };
}

/**
 * Calculates all lines and invoice totals. The grand total is rounded to the nearest
 * rupee and the difference is reported separately as `roundOff`.
 */
export function calculateInvoice(items, supplyType) {
  const lines = items.map((item) => ({ ...item, ...calculateLine(item, supplyType) }));

  const sum = (key) => lines.reduce((acc, line) => acc.plus(line[key]), new Decimal(0));
  const subtotal = sum('grossAmount');
  const totalDiscount = sum('discountAmount');
  const taxableAmount = sum('taxableValue');
  const cgstAmount = sum('cgstAmount');
  const sgstAmount = sum('sgstAmount');
  const igstAmount = sum('igstAmount');
  const totalTax = cgstAmount.plus(sgstAmount).plus(igstAmount);
  const exactTotal = taxableAmount.plus(totalTax);
  const grandTotal = exactTotal.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  return {
    lines,
    totals: {
      subtotal: subtotal.toNumber(),
      totalDiscount: totalDiscount.toNumber(),
      taxableAmount: taxableAmount.toNumber(),
      cgstAmount: cgstAmount.toNumber(),
      sgstAmount: sgstAmount.toNumber(),
      igstAmount: igstAmount.toNumber(),
      totalTax: totalTax.toNumber(),
      roundOff: grandTotal.minus(exactTotal).toNumber(),
      grandTotal: grandTotal.toNumber(),
    },
  };
}

/** Tax breakup grouped by HSN code and GST rate, as printed on GST invoices. */
export function hsnSummary(lines) {
  const groups = new Map();
  for (const line of lines) {
    const key = `${line.hsnCode ?? ''}|${line.gstRate}`;
    const group = groups.get(key) ?? {
      hsnCode: line.hsnCode ?? null,
      gstRate: Number(line.gstRate),
      taxableValue: new Decimal(0),
      cgstAmount: new Decimal(0),
      sgstAmount: new Decimal(0),
      igstAmount: new Decimal(0),
    };
    group.taxableValue = group.taxableValue.plus(line.taxableValue);
    group.cgstAmount = group.cgstAmount.plus(line.cgstAmount);
    group.sgstAmount = group.sgstAmount.plus(line.sgstAmount);
    group.igstAmount = group.igstAmount.plus(line.igstAmount);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({
    hsnCode: g.hsnCode,
    gstRate: g.gstRate,
    taxableValue: g.taxableValue.toNumber(),
    cgstAmount: g.cgstAmount.toNumber(),
    sgstAmount: g.sgstAmount.toNumber(),
    igstAmount: g.igstAmount.toNumber(),
    totalTax: g.cgstAmount.plus(g.sgstAmount).plus(g.igstAmount).toNumber(),
  }));
}

/** Indian financial year (April-March) for a 'YYYY-MM-DD' date, e.g. '2026-27'. */
export function financialYear(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
