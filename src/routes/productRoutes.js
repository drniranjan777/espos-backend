import { Router } from 'express';
import * as inventory from '../controllers/inventoryController.js';
import * as products from '../controllers/productController.js';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.js';
import {
  adjustmentSchema,
  ledgerQuerySchema,
  stockInSchema,
  stockOutSchema,
} from '../validators/inventoryValidators.js';
import {
  createProductSchema,
  listProductsSchema,
  quickSearchSchema,
  updateProductSchema,
} from '../validators/productValidators.js';

export const productRouter = Router();

productRouter.get('/', requirePermission(P.PRODUCTS_VIEW), validate({ query: listProductsSchema }), products.list);
productRouter.get(
  '/search',
  requirePermission(P.PRODUCTS_VIEW),
  validate({ query: quickSearchSchema }),
  products.search,
);
productRouter.get('/:id', requirePermission(P.PRODUCTS_VIEW), validate({ params: idParam }), products.get);
productRouter.post(
  '/',
  requirePermission(P.PRODUCTS_CREATE),
  validate({ body: createProductSchema }),
  products.create,
);
productRouter.patch(
  '/:id',
  requirePermission(P.PRODUCTS_UPDATE),
  validate({ params: idParam, body: updateProductSchema }),
  products.update,
);
productRouter.delete('/:id', requirePermission(P.PRODUCTS_DELETE), validate({ params: idParam }), products.remove);

export const inventoryRouter = Router();

inventoryRouter.get('/', requirePermission(P.INVENTORY_VIEW), validate({ query: listProductsSchema }), inventory.stock);
inventoryRouter.get(
  '/ledger',
  requirePermission(P.INVENTORY_VIEW),
  validate({ query: ledgerQuerySchema }),
  inventory.ledger,
);
inventoryRouter.post('/stock-in', requirePermission(P.INVENTORY_IN), validate({ body: stockInSchema }), inventory.stockIn);
inventoryRouter.post(
  '/stock-out',
  requirePermission(P.INVENTORY_OUT),
  validate({ body: stockOutSchema }),
  inventory.stockOut,
);
inventoryRouter.post(
  '/adjustments',
  requirePermission(P.INVENTORY_ADJUST),
  validate({ body: adjustmentSchema }),
  inventory.adjust,
);
