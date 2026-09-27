import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import pdfmake from 'pdfmake';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);
const fonts = require('pdfmake/fonts/Roboto.js');
pdfmake.setFonts(fonts);

// Documents are built only from our own data: no remote fetches, and the only local
// files pdfmake may open are the bundled fonts (the logo is embedded as a data URL).
const allowedFontFiles = new Set(Object.values(fonts.Roboto).map((file) => path.resolve(file)));
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((file) => allowedFontFiles.has(path.resolve(file)));

const COLORS = { text: '#1f2937', muted: '#6b7280', border: '#d1d5db', header: '#f3f4f6' };

const money = (value) =>
  Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (value) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 3 });

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

async function logoDataUrl(filePath) {
  if (!filePath) return null;
  try {
    const data = await fs.readFile(filePath);
    const mime = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (err) {
    logger.warn({ err }, 'Invoice logo could not be read');
    return null;
  }
}

const thinLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => COLORS.border,
  vLineColor: () => COLORS.border,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

function lines(...values) {
  return values.filter(Boolean).join('\n');
}

function companyBlock(company, logo) {
  const details = {
    stack: [
      { text: company.companyName, style: 'companyName' },
      {
        text: lines(company.address, [company.city, company.pincode].filter(Boolean).join(' - ')),
        style: 'small',
      },
      { text: lines(company.phone && `Phone: ${company.phone}`, company.email), style: 'small' },
      {
        text: lines(
          company.gstin && `GSTIN: ${company.gstin}`,
          company.pan && `PAN: ${company.pan}`,
        ),
        style: 'smallBold',
      },
      company.state && { text: `State: ${company.state} (${company.stateCode})`, style: 'small' },
    ].filter(Boolean),
  };
  return logo
    ? { columns: [{ image: logo, fit: [70, 70], width: 80 }, details], columnGap: 8 }
    : details;
}

function partyBlock(title, name, company, address, extra) {
  return {
    stack: [
      { text: title, style: 'label' },
      { text: company || name, bold: true },
      company && name !== company ? { text: name, style: 'small' } : null,
      { text: address ?? '', style: 'small' },
      ...extra,
    ].filter(Boolean),
  };
}

function itemsTable(invoice) {
  const header = [
    '#',
    'Description',
    'HSN',
    'Qty',
    'Rate',
    'Disc %',
    'Taxable',
    'GST %',
    'Amount',
  ].map((text) => ({
    text,
    style: 'tableHeader',
  }));
  const body = invoice.items.map((item) => [
    item.lineNo,
    {
      stack: [
        item.productName,
        { text: [item.sku, item.partNumber].filter(Boolean).join(' | '), style: 'tiny' },
      ],
    },
    item.hsnCode ?? '',
    { text: `${qty(item.quantity)} ${item.unit ?? ''}`, alignment: 'right' },
    { text: money(item.rate), alignment: 'right' },
    { text: Number(item.discountPercent) ? qty(item.discountPercent) : '-', alignment: 'right' },
    { text: money(item.taxableValue), alignment: 'right' },
    { text: qty(item.gstRate), alignment: 'right' },
    { text: money(item.lineTotal), alignment: 'right' },
  ]);
  return {
    table: {
      headerRows: 1,
      widths: [14, '*', 42, 44, 50, 30, 56, 28, 60],
      body: [header, ...body],
    },
    layout: thinLayout,
    fontSize: 8,
  };
}

function totalsTable(invoice) {
  const rows = [['Taxable Amount', money(invoice.taxableAmount)]];
  if (invoice.supplyType === 'INTER') {
    rows.push(['IGST', money(invoice.igstAmount)]);
  } else {
    rows.push(['CGST', money(invoice.cgstAmount)], ['SGST', money(invoice.sgstAmount)]);
  }
  if (Number(invoice.roundOff)) rows.push(['Round Off', money(invoice.roundOff)]);
  rows.push([
    { text: 'Grand Total', bold: true },
    { text: `Rs. ${money(invoice.grandTotal)}`, bold: true },
  ]);
  return {
    table: { widths: ['*', 90], body: rows.map(([l, v]) => [l, { text: v, alignment: 'right' }]) },
    layout: thinLayout,
  };
}

function hsnTable(invoice) {
  const inter = invoice.supplyType === 'INTER';
  const header = [
    'HSN',
    'GST %',
    'Taxable',
    ...(inter ? ['IGST'] : ['CGST', 'SGST']),
    'Total Tax',
  ].map((text) => ({
    text,
    style: 'tableHeader',
  }));
  const body = invoice.hsnSummary.map((row) => [
    row.hsnCode ?? '-',
    { text: qty(row.gstRate), alignment: 'right' },
    { text: money(row.taxableValue), alignment: 'right' },
    ...(inter
      ? [{ text: money(row.igstAmount), alignment: 'right' }]
      : [
          { text: money(row.cgstAmount), alignment: 'right' },
          { text: money(row.sgstAmount), alignment: 'right' },
        ]),
    { text: money(row.totalTax), alignment: 'right' },
  ]);
  return {
    table: {
      headerRows: 1,
      widths: inter ? ['*', 30, 65, 65, 65] : ['*', 30, 55, 50, 50, 55],
      body: [header, ...body],
    },
    layout: thinLayout,
    fontSize: 8,
  };
}

/**
 * Renders a GST invoice as a PDF buffer.
 * @param {object} invoice  result of invoiceService.getById
 * @param {string|null} logoPath absolute path of the company logo
 */
export async function renderInvoicePdf(invoice, logoPath) {
  const company = invoice.company;
  const logo = await logoDataUrl(logoPath);
  const watermark =
    invoice.status === 'CANCELLED'
      ? { text: 'CANCELLED', color: '#dc2626', opacity: 0.15, bold: true }
      : invoice.status === 'DRAFT'
        ? { text: 'DRAFT', color: '#6b7280', opacity: 0.12, bold: true }
        : undefined;

  const bankLines = lines(
    company.bankName && `Bank: ${company.bankName}`,
    company.bankAccountName && `A/c Name: ${company.bankAccountName}`,
    company.bankAccountNumber && `A/c No: ${company.bankAccountNumber}`,
    company.bankIfsc && `IFSC: ${company.bankIfsc}`,
    company.bankBranch && `Branch: ${company.bankBranch}`,
  );

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [28, 28, 28, 40],
    info: { title: invoice.invoiceNo ?? `Draft invoice ${invoice.id}` },
    watermark,
    defaultStyle: { font: 'Roboto', fontSize: 9, color: COLORS.text },
    footer: (current, total) => ({
      text: `Page ${current} of ${total}  |  This is a computer generated invoice`,
      alignment: 'center',
      style: 'tiny',
      margin: [0, 12, 0, 0],
    }),
    content: [
      {
        columns: [
          { width: '*', ...companyBlock(company, logo) },
          {
            width: 170,
            stack: [
              { text: 'TAX INVOICE', style: 'title' },
              {
                text: `Invoice No: ${invoice.invoiceNo ?? 'DRAFT'}`,
                bold: true,
                alignment: 'right',
              },
              { text: `Date: ${formatDate(invoice.invoiceDate)}`, alignment: 'right' },
              {
                text: `Place of Supply: ${invoice.placeOfSupplyState ?? '-'}${invoice.placeOfSupplyStateCode ? ` (${invoice.placeOfSupplyStateCode})` : ''}`,
                alignment: 'right',
                style: 'small',
              },
            ],
          },
        ],
      },
      {
        canvas: [
          { type: 'line', x1: 0, y1: 6, x2: 539, y2: 6, lineWidth: 0.5, lineColor: COLORS.border },
        ],
      },
      {
        margin: [0, 8, 0, 8],
        columns: [
          partyBlock(
            'BILL TO',
            invoice.customerName,
            invoice.customerCompanyName,
            invoice.billingAddress,
            [
              invoice.customerGstin && {
                text: `GSTIN: ${invoice.customerGstin}`,
                style: 'smallBold',
              },
              invoice.customerState && {
                text: `State: ${invoice.customerState} (${invoice.customerStateCode})`,
                style: 'small',
              },
              invoice.customerMobile && {
                text: `Mobile: ${invoice.customerMobile}`,
                style: 'small',
              },
            ].filter(Boolean),
          ),
          partyBlock(
            'SHIP TO',
            invoice.customerName,
            invoice.customerCompanyName,
            invoice.shippingAddress,
            [],
          ),
        ],
        columnGap: 16,
      },
      itemsTable(invoice),
      {
        margin: [0, 8, 0, 0],
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Amount in words', style: 'label' },
              { text: invoice.amountInWords, bold: true, margin: [0, 0, 0, 8] },
              hsnTable(invoice),
            ],
          },
          { width: 200, ...totalsTable(invoice) },
        ],
        columnGap: 12,
      },
      {
        margin: [0, 16, 0, 0],
        columns: [
          {
            width: '*',
            stack: [
              bankLines && { text: 'Bank Details', style: 'label' },
              bankLines && { text: bankLines, style: 'small', margin: [0, 0, 0, 8] },
              company.termsAndConditions && { text: 'Terms & Conditions', style: 'label' },
              company.termsAndConditions && { text: company.termsAndConditions, style: 'small' },
              invoice.notes && { text: 'Notes', style: 'label', margin: [0, 8, 0, 0] },
              invoice.notes && { text: invoice.notes, style: 'small' },
            ].filter(Boolean),
          },
          {
            width: 180,
            stack: [
              { text: `For ${company.companyName}`, bold: true, alignment: 'right' },
              { text: '\n\n\nAuthorised Signatory', alignment: 'right', style: 'small' },
            ],
          },
        ],
      },
      invoice.status === 'CANCELLED' && {
        text: `Cancelled: ${invoice.cancelReason ?? ''}`,
        color: '#dc2626',
        margin: [0, 12, 0, 0],
      },
    ].filter(Boolean),
    styles: {
      title: { fontSize: 14, bold: true, alignment: 'right', margin: [0, 0, 0, 4] },
      companyName: { fontSize: 13, bold: true, margin: [0, 0, 0, 2] },
      label: { fontSize: 7, bold: true, color: COLORS.muted, margin: [0, 0, 0, 2] },
      small: { fontSize: 8 },
      smallBold: { fontSize: 8, bold: true },
      tiny: { fontSize: 7, color: COLORS.muted },
      tableHeader: { bold: true, fillColor: COLORS.header, fontSize: 8 },
    },
  };

  return pdfmake.createPdf(docDefinition).getBuffer();
}
