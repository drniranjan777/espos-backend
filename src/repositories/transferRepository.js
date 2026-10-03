import { db } from '../config/database.js';
import { paginate } from '../utils/pagination.js';

const HEADER_COLUMNS = [
  't.id',
  't.transfer_no as transferNo',
  't.status',
  't.from_warehouse_id as fromWarehouseId',
  'wf.name as fromBranchName',
  't.to_warehouse_id as toWarehouseId',
  'wt.name as toBranchName',
  't.invoice_number as invoiceNumber',
  't.note',
  't.line_count as lineCount',
  't.total_quantity as totalQuantity',
  't.requested_by as requestedBy',
  'ur.name as requestedByName',
  't.requested_at as requestedAt',
  'ua.name as approvedByName',
  't.approved_at as approvedAt',
  'uv.name as receivedByName',
  't.received_at as receivedAt',
  'uc.name as closedByName',
  't.closed_at as closedAt',
  't.close_reason as closeReason',
  't.updated_at as updatedAt',
];

function baseQuery(trx = db) {
  return trx('stock_transfers as t')
    .join('warehouses as wf', 'wf.id', 't.from_warehouse_id')
    .join('warehouses as wt', 'wt.id', 't.to_warehouse_id')
    .leftJoin('users as ur', 'ur.id', 't.requested_by')
    .leftJoin('users as ua', 'ua.id', 't.approved_by')
    .leftJoin('users as uv', 'uv.id', 't.received_by')
    .leftJoin('users as uc', 'uc.id', 't.closed_by');
}

export async function insertHeader(data, trx) {
  const [row] = await trx('stock_transfers').insert(data).returning('id');
  return row.id;
}

export async function insertItems(rows, trx) {
  await trx('stock_transfer_items').insert(rows);
}

export async function update(id, data, trx) {
  await trx('stock_transfers').where({ id }).update(data);
}

/** Locks the transfer row so two people cannot approve/receive/cancel it at once. */
export async function lockById(id, trx) {
  return (
    (await trx('stock_transfers')
      .where({ id })
      .forUpdate()
      .first(
        'id',
        'status',
        'from_warehouse_id',
        'to_warehouse_id',
        'requested_by',
        'transfer_no',
      )) ?? null
  );
}

export async function findItems(transferId, trx = db) {
  return trx('stock_transfer_items as ti')
    .join('stock_transfers as t', 't.id', 'ti.transfer_id')
    .join('products as p', 'p.id', 'ti.product_id')
    .join('units as un', 'un.id', 'p.unit_id')
    .leftJoin('inventory as i', (j) =>
      j.on('i.product_id', 'ti.product_id').andOn('i.warehouse_id', 't.from_warehouse_id'),
    )
    .where('ti.transfer_id', transferId)
    .orderBy('ti.line_no')
    .select(
      'ti.line_no as lineNo',
      'ti.product_id as productId',
      'p.name as productName',
      'p.sku',
      'p.part_number as partNumber',
      'un.code as unitCode',
      'ti.quantity',
      // Current stock at the source branch, so approvers can see if it is still available.
      db.raw('COALESCE(i.quantity, 0) as "sourceStock"'),
    );
}

export async function findById(id, trx = db) {
  const transfer = await baseQuery(trx).where('t.id', id).first(HEADER_COLUMNS);
  if (!transfer) return null;
  transfer.items = await findItems(id, trx);
  return transfer;
}

/**
 * @param {number|null} warehouseId  limit to transfers from/to this branch (null = all branches)
 */
export function list(warehouseId, filters) {
  const query = baseQuery().select(HEADER_COLUMNS);
  if (warehouseId) {
    if (filters.direction === 'outgoing') query.where('t.from_warehouse_id', warehouseId);
    else if (filters.direction === 'incoming') query.where('t.to_warehouse_id', warehouseId);
    else {
      query.where((q) =>
        q.where('t.from_warehouse_id', warehouseId).orWhere('t.to_warehouse_id', warehouseId),
      );
    }
  }
  if (filters.status?.length) query.whereIn('t.status', filters.status);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query.where((q) => q.whereILike('t.transfer_no', term).orWhereILike('t.invoice_number', term));
  }
  return paginate(query, filters, { createdAt: 't.id' }, 't.id');
}
