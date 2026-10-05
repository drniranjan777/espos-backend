import { Router } from 'express';
import { checkDatabaseConnection } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { resolveBranch } from '../middleware/branch.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { askStockRouter } from './askStockRoutes.js';
import { authRouter } from './authRoutes.js';
import { branchRouter } from './branchRoutes.js';
import { customerRouter } from './customerRoutes.js';
import { invoiceRouter } from './invoiceRoutes.js';
import { settingsRouter } from './settingsRoutes.js';
import {
  adjustmentCodeRouter,
  brandRouter,
  categoryRouter,
  gstRateRouter,
  unitRouter,
} from './masterRoutes.js';
import { inventoryRouter, productRouter } from './productRoutes.js';
import { movementRouter } from './movementRoutes.js';
import { transferRouter } from './transferRoutes.js';
import { auditRouter, dashboardRouter, reportRouter } from './reportRoutes.js';
import { roleRouter, userRouter } from './userRoutes.js';

export const apiRouter = Router();

// ---- Public ----
apiRouter.get('/health', async (_req, res) => {
  await checkDatabaseConnection();
  return sendSuccess(res, { status: 'ok', time: new Date().toISOString() });
});
apiRouter.use('/auth', authRouter);

// ---- Authenticated ----
apiRouter.use(authenticate);
apiRouter.use('/users', userRouter);
apiRouter.use('/roles', roleRouter);
apiRouter.use('/branches', branchRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/brands', brandRouter);
apiRouter.use('/units', unitRouter);
apiRouter.use('/gst-rates', gstRateRouter);
apiRouter.use('/adjustment-codes', adjustmentCodeRouter);
apiRouter.use('/customers', customerRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/audit-logs', auditRouter);

// ---- Branch-scoped (stock figures and documents belong to the selected branch) ----
apiRouter.use('/products', resolveBranch, productRouter);
apiRouter.use('/inventory', resolveBranch, inventoryRouter);
apiRouter.use('/stock-movements', resolveBranch, movementRouter);
apiRouter.use('/transfers', resolveBranch, transferRouter);
apiRouter.use('/invoices', resolveBranch, invoiceRouter);
apiRouter.use('/dashboard', resolveBranch, dashboardRouter);
apiRouter.use('/reports', resolveBranch, reportRouter);
apiRouter.use('/ask-stock', resolveBranch, askStockRouter);
