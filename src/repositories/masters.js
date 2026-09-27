import { createMasterRepository } from './masterRepository.js';

export const categoryRepository = createMasterRepository({
  table: 'categories',
  fields: {
    name: 'name',
    parentId: 'parent_id',
    description: 'description',
    isActive: 'is_active',
  },
  readOnly: { parentName: 'p.name' },
  searchColumns: ['name'],
  orderBy: 'name',
  decorate: (q) => q.leftJoin('categories as p', 'p.id', 'm.parent_id'),
});

export const brandRepository = createMasterRepository({
  table: 'brands',
  fields: { name: 'name', isActive: 'is_active' },
  searchColumns: ['name'],
  orderBy: 'name',
});

export const unitRepository = createMasterRepository({
  table: 'units',
  fields: { name: 'name', code: 'code', allowDecimal: 'allow_decimal', isActive: 'is_active' },
  searchColumns: ['name', 'code'],
  orderBy: 'code',
});

export const gstRateRepository = createMasterRepository({
  table: 'gst_rates',
  fields: { name: 'name', rate: 'rate', isActive: 'is_active' },
  readOnly: { cgstRate: 'cgst_rate', sgstRate: 'sgst_rate', igstRate: 'igst_rate' },
  searchColumns: ['name'],
  orderBy: 'rate',
});

export const adjustmentCodeRepository = createMasterRepository({
  table: 'adjustment_codes',
  fields: { code: 'code', name: 'name', direction: 'direction', isActive: 'is_active' },
  searchColumns: ['code', 'name'],
  orderBy: 'id',
});
