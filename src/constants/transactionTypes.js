/** Inventory ledger transaction types. Positive types add stock, negative types remove it. */
export const TXN_TYPE = Object.freeze({
  OPENING: 'OPENING',
  IN: 'IN',
  OUT: 'OUT',
  ADJUSTMENT_IN: 'ADJUSTMENT_IN',
  ADJUSTMENT_OUT: 'ADJUSTMENT_OUT',
  INVOICE_OUT: 'INVOICE_OUT',
  INVOICE_CANCEL: 'INVOICE_CANCEL',
});

export const TRANSACTION_TYPES = Object.values(TXN_TYPE);

export const INBOUND_TYPES = [
  TXN_TYPE.OPENING,
  TXN_TYPE.IN,
  TXN_TYPE.ADJUSTMENT_IN,
  TXN_TYPE.INVOICE_CANCEL,
];
export const OUTBOUND_TYPES = [TXN_TYPE.OUT, TXN_TYPE.ADJUSTMENT_OUT, TXN_TYPE.INVOICE_OUT];
