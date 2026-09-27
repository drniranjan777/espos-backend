import { Router } from 'express';
import { checkDatabaseConnection } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { authRouter } from './authRoutes.js';
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
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/brands', brandRouter);
apiRouter.use('/units', unitRouter);
apiRouter.use('/gst-rates', gstRateRouter);
apiRouter.use('/adjustment-codes', adjustmentCodeRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/customers', customerRouter);
apiRouter.use('/invoices', invoiceRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/reports', reportRouter);
apiRouter.use('/audit-logs', auditRouter);
