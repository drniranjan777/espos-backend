import { Router } from 'express';
import { checkDatabaseConnection } from '../config/database.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { authRouter } from './authRoutes.js';

export const apiRouter = Router();

apiRouter.get('/health', async (_req, res) => {
  await checkDatabaseConnection();
  return sendSuccess(res, { status: 'ok', time: new Date().toISOString() });
});

apiRouter.use('/auth', authRouter);
