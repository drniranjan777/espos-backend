import { Router } from 'express';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { createMasterController } from '../controllers/masterController.js';
import { requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import {
  adjustmentCodeService,
  brandService,
  categoryService,
  gstRateService,
  unitService,
} from '../services/masters.js';
import { idParam } from '../validators/common.js';
import {
  adjustmentCodeCreateSchema,
  adjustmentCodeUpdateSchema,
  brandSchema,
  categorySchema,
  gstRateCreateSchema,
  gstRateUpdateSchema,
  masterListSchema,
  unitSchema,
} from '../validators/masterValidators.js';

/**
 * Master lists are readable by any signed-in user (they populate dropdowns);
 * writes require the given permission.
 */
function masterRouter({ service, entityName, writePermission, createSchema, updateSchema }) {
  const c = createMasterController(service, entityName);
  const canWrite = requirePermission(writePermission);
  const router = Router();

  router.get('/', validate({ query: masterListSchema }), c.list);
  router.get('/:id', validate({ params: idParam }), c.get);
  router.post('/', canWrite, validate({ body: createSchema }), c.create);
  router.patch('/:id', canWrite, validate({ params: idParam, body: updateSchema }), c.update);
  router.delete('/:id', canWrite, validate({ params: idParam }), c.remove);
  return router;
}

export const categoryRouter = masterRouter({
  service: categoryService,
  entityName: 'Category',
  writePermission: P.MASTERS_MANAGE,
  createSchema: categorySchema,
  updateSchema: categorySchema.partial(),
});

export const brandRouter = masterRouter({
  service: brandService,
  entityName: 'Brand',
  writePermission: P.MASTERS_MANAGE,
  createSchema: brandSchema,
  updateSchema: brandSchema.partial(),
});

export const unitRouter = masterRouter({
  service: unitService,
  entityName: 'Unit',
  writePermission: P.MASTERS_MANAGE,
  createSchema: unitSchema,
  updateSchema: unitSchema.partial(),
});

export const gstRateRouter = masterRouter({
  service: gstRateService,
  entityName: 'GST rate',
  writePermission: P.GST_MANAGE,
  createSchema: gstRateCreateSchema,
  updateSchema: gstRateUpdateSchema,
});

export const adjustmentCodeRouter = masterRouter({
  service: adjustmentCodeService,
  entityName: 'Adjustment code',
  writePermission: P.MASTERS_MANAGE,
  createSchema: adjustmentCodeCreateSchema,
  updateSchema: adjustmentCodeUpdateSchema,
});
