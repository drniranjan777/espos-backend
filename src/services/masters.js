import { AUDIT_MODULE } from '../constants/audit.js';
import {
  adjustmentCodeRepository,
  brandRepository,
  categoryRepository,
  gstRateRepository,
  unitRepository,
} from '../repositories/masters.js';
import { ApiError } from '../utils/ApiError.js';
import { createMasterService } from './masterService.js';

/** Categories are two levels deep: a top-level category and its sub-categories. */
async function validateCategoryParent(data, before, trx) {
  if (!data.parentId) return;
  if (before && data.parentId === before.id) {
    throw ApiError.badRequest('A category cannot be its own parent');
  }

  const parent = await categoryRepository.findById(data.parentId, trx);
  if (!parent) throw ApiError.badRequest('Parent category does not exist');
  if (parent.parentId) {
    throw ApiError.badRequest('Sub-categories cannot have their own sub-categories');
  }

  if (before) {
    const hasChildren = await trx('categories').where({ parent_id: before.id }).first('id');
    if (hasChildren) {
      throw ApiError.badRequest('A category with sub-categories cannot become a sub-category');
    }
  }
}

export const categoryService = createMasterService(categoryRepository, {
  module: AUDIT_MODULE.CATEGORIES,
  entityName: 'Category',
  beforeSave: validateCategoryParent,
});

export const brandService = createMasterService(brandRepository, {
  module: AUDIT_MODULE.BRANDS,
  entityName: 'Brand',
});

export const unitService = createMasterService(unitRepository, {
  module: AUDIT_MODULE.UNITS,
  entityName: 'Unit',
});

export const gstRateService = createMasterService(gstRateRepository, {
  module: AUDIT_MODULE.GST_RATES,
  entityName: 'GST rate',
});

export const adjustmentCodeService = createMasterService(adjustmentCodeRepository, {
  module: AUDIT_MODULE.ADJUSTMENT_CODES,
  entityName: 'Adjustment code',
});
