import { renderInvoicePdf } from '../pdf/invoicePdf.js';
import * as invoiceService from '../services/invoiceService.js';
import { logoFilePath } from '../services/settingsService.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/apiResponse.js';

export async function list(req, res) {
  return sendPaginated(res, await invoiceService.list(req.validated.query));
}

export async function get(req, res) {
  return sendSuccess(res, await invoiceService.getById(req.validated.params.id));
}

export async function create(req, res) {
  const invoice = await invoiceService.create(req.validated.body, req.context);
  return sendCreated(res, invoice, invoice.status === 'FINAL' ? 'Invoice created' : 'Draft saved');
}

export async function update(req, res) {
  const invoice = await invoiceService.update(
    req.validated.params.id,
    req.validated.body,
    req.context,
  );
  return sendSuccess(res, invoice, { message: 'Draft updated' });
}

export async function finalize(req, res) {
  const invoice = await invoiceService.finalize(req.validated.params.id, req.context);
  return sendSuccess(res, invoice, { message: `Invoice ${invoice.invoiceNo} created` });
}

export async function cancel(req, res) {
  const invoice = await invoiceService.cancel(
    req.validated.params.id,
    req.validated.body,
    req.context,
  );
  return sendSuccess(res, invoice, { message: 'Invoice cancelled and stock restored' });
}

export async function remove(req, res) {
  await invoiceService.removeDraft(req.validated.params.id, req.context);
  return sendSuccess(res, null, { message: 'Draft deleted' });
}

export async function pdf(req, res) {
  const invoice = await invoiceService.getById(req.validated.params.id);
  const buffer = await renderInvoicePdf(invoice, logoFilePath(invoice.company.logoPath));
  const fileName = `${(invoice.invoiceNo ?? `draft-${invoice.id}`).replaceAll('/', '-')}.pdf`;
  res
    .status(200)
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${req.query.download === 'true' ? 'attachment' : 'inline'}; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
    })
    .send(buffer);
}
