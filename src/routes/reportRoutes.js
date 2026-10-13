import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import * as dashboardService from '../services/dashboardService.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { isoDate } from '../validators/common.js';

// ---- Dashboard ----
export const dashboardRouter = Router();
dashboardRouter.use(requirePermission(P.DASHBOARD_VIEW));

dashboardRouter.get('/summary', async (req, res) =>
  sendSuccess(res, await dashboardService.getSummary(req.user, req.context.warehouseId)),
);

dashboardRouter.get(
  '/movement',
  validate({ query: z.object({ range: z.enum(['daily', 'weekly', 'monthly']).default('daily') }) }),
  async (req, res) =>
    sendSuccess(
      res,
      await dashboardService.getMovement(req.validated.query.range, req.context.warehouseId),
    ),
);

// ---- Reports ----
export const reportRouter = Router();
reportRouter.use(requirePermission(P.REPORTS_VIEW));

reportRouter.get(
  '/stock-valuation',
  validate({
    query: z.object({
      search: z.string().trim().max(100).optional(),
      categoryId: z.coerce.number().int().positive().optional(),
    }),
  }),
  async (req, res) =>
    sendSuccess(
      res,
      await dashboardService.stockValuationReport(req.validated.query, req.context.warehouseId),
    ),
);

const MAX_REPORT_DAYS = 366;

reportRouter.get(
  '/movement',
  validate({
    query: z
      .object({ from: isoDate, to: isoDate, search: z.string().trim().max(100).optional() })
      .refine((q) => q.from <= q.to, {
        path: ['to'],
        message: 'End date must be after start date',
      }),
  }),
  async (req, res) => {
    const { from, to } = req.validated.query;
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (days > MAX_REPORT_DAYS) throw ApiError.badRequest('Choose a range of at most one year');
    return sendSuccess(
      res,
      await dashboardService.movementReport(req.validated.query, req.context.warehouseId),
    );
  },
);
