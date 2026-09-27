import { describe, expect, it } from 'vitest';
import {
  calculateInvoice,
  calculateLine,
  determineSupplyType,
  financialYear,
  hsnSummary,
} from '../../src/utils/gstCalculator.js';
import { amountInWords, integerToWords } from '../../src/utils/numberToWords.js';

describe('determineSupplyType', () => {
  it('is intra-state when company and place of supply match', () => {
    expect(determineSupplyType('27', '27')).toBe('INTRA');
  });
  it('is inter-state when states differ', () => {
    expect(determineSupplyType('27', '29')).toBe('INTER');
  });
  it('falls back to intra-state when a state is unknown', () => {
    expect(determineSupplyType('27', null)).toBe('INTRA');
    expect(determineSupplyType(null, '29')).toBe('INTRA');
  });
});

describe('calculateLine', () => {
  it('splits GST into CGST + SGST for intra-state supply', () => {
    const line = calculateLine({ quantity: 2, rate: 850, gstRate: 18 }, 'INTRA');
    expect(line).toMatchObject({
      taxableValue: 1700,
      cgstRate: 9,
      cgstAmount: 153,
      sgstRate: 9,
      sgstAmount: 153,
      igstAmount: 0,
      lineTotal: 2006,
    });
  });

  it('charges IGST for inter-state supply', () => {
    const line = calculateLine({ quantity: 2, rate: 850, gstRate: 18 }, 'INTER');
    expect(line).toMatchObject({
      cgstAmount: 0,
      sgstAmount: 0,
      igstRate: 18,
      igstAmount: 306,
      lineTotal: 2006,
    });
  });

  it('applies discount before tax', () => {
    const line = calculateLine(
      { quantity: 1, rate: 1000, discountPercent: 10, gstRate: 28 },
      'INTER',
    );
    expect(line).toMatchObject({
      grossAmount: 1000,
      discountAmount: 100,
      taxableValue: 900,
      igstAmount: 252,
    });
  });

  it('avoids floating point errors', () => {
    // 0.1 * 3 would be 0.30000000000000004 in plain JS.
    const line = calculateLine({ quantity: 3, rate: 0.1, gstRate: 0 }, 'INTRA');
    expect(line.taxableValue).toBe(0.3);
    const oil = calculateLine({ quantity: 2.25, rate: 195, gstRate: 18 }, 'INTRA');
    expect(oil.taxableValue).toBe(438.75);
    expect(oil.cgstAmount).toBe(39.49); // 39.4875 rounds half-up
    expect(oil.sgstAmount).toBe(39.49);
  });

  it('handles 0% GST', () => {
    const line = calculateLine({ quantity: 4, rate: 50, gstRate: 0 }, 'INTRA');
    expect(line.lineTotal).toBe(200);
  });
});

describe('calculateInvoice', () => {
  it('sums lines and rounds the grand total to the nearest rupee', () => {
    const { totals } = calculateInvoice(
      [
        { quantity: 1, rate: 99.99, gstRate: 18 },
        { quantity: 3, rate: 245, gstRate: 5 },
      ],
      'INTRA',
    );
    // Line 1: 99.99 + 9.00 + 9.00 (8.9991 -> 9.00) = 117.99
    // Line 2: 735 + 18.38 + 18.38 (18.375 -> 18.38) = 771.76
    expect(totals).toEqual({
      subtotal: 834.99,
      totalDiscount: 0,
      taxableAmount: 834.99,
      cgstAmount: 27.38,
      sgstAmount: 27.38,
      igstAmount: 0,
      totalTax: 54.76,
      roundOff: 0.25,
      grandTotal: 890,
    });
  });

  it('rounds down when below half a rupee', () => {
    const { totals } = calculateInvoice([{ quantity: 1, rate: 100.2, gstRate: 0 }], 'INTRA');
    expect(totals.grandTotal).toBe(100);
    expect(totals.roundOff).toBe(-0.2);
  });

  it('builds an HSN-wise tax summary', () => {
    const { lines } = calculateInvoice(
      [
        { hsnCode: '8421', quantity: 1, rate: 100, gstRate: 18 },
        { hsnCode: '8421', quantity: 2, rate: 100, gstRate: 18 },
        { hsnCode: '2710', quantity: 1, rate: 100, gstRate: 5 },
      ],
      'INTRA',
    );
    const summary = hsnSummary(lines);
    expect(summary).toHaveLength(2);
    expect(summary[0]).toMatchObject({
      hsnCode: '8421',
      taxableValue: 300,
      cgstAmount: 27,
      totalTax: 54,
    });
  });
});

describe('financialYear', () => {
  it('uses April-March years', () => {
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2099-12-01')).toBe('2099-00');
  });
});

describe('amountInWords', () => {
  it('uses the Indian numbering system', () => {
    expect(integerToWords(0)).toBe('Zero');
    expect(integerToWords(115)).toBe('One Hundred Fifteen');
    expect(integerToWords(125000)).toBe('One Lakh Twenty Five Thousand');
    expect(integerToWords(10000000)).toBe('One Crore');
  });
  it('includes paise', () => {
    expect(amountInWords(1250.5)).toBe(
      'Rupees One Thousand Two Hundred Fifty and Fifty Paise Only',
    );
    expect(amountInWords(890)).toBe('Rupees Eight Hundred Ninety Only');
  });
});
