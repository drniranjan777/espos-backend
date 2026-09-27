import { Router } from 'express';
import { z } from 'zod';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import { AUDIT_SORT_FIELDS } from '../repositories/auditRepository.js';
import * as auditService from '../services/auditService.js';
import * as dashboardService from '../services/dashboardService.js';
import { ApiError } from '../utils/ApiError.js';
import { sendPaginated, sendSuccess } from '../utils/apiResponse.js';
import { listQuerySchema } from '../utils/pagination.js';
import { isoDate } from '../validators/common.js';

// ---- Dashboard ----
export const dashboardRouter = Router();
dashboardRouter.use(requirePermission(P.DASHBOARD_VIEW));

dashboardRouter.get('/summary', async (req, res) =>
  sendSuccess(res, await dashboardService.getSummary(req.user)),
);

dashboardRouter.get(
  '/movement',
  validate({ query: z.object({ range: z.enum(['daily', 'weekly', 'monthly']).default('daily') }) }),
  async (req, res) =>
    sendSuccess(res, await dashboardService.getMovement(req.validated.query.range)),
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
    sendSuccess(res, await dashboardService.stockValuationReport(req.validated.query)),
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
    return sendSuccess(res, await dashboardService.movementReport(req.validated.query));
  },
);

// ---- Audit logs ----
export const auditRouter = Router();
auditRouter.use(requirePermission(P.AUDIT_VIEW));

auditRouter.get(
  '/',
  validate({
    query: listQuerySchema(AUDIT_SORT_FIELDS, 'createdAt', {
      sortOrder: z.enum(['asc', 'desc']).default('desc'),
      module: z.enum(Object.values(AUDIT_MODULE)).optional(),
      action: z.enum(Object.values(AUDIT_ACTION)).optional(),
      userId: z.coerce.number().int().positive().optional(),
      recordId: z.string().max(50).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
    }),
  }),
  async (req, res) => sendPaginated(res, await auditService.list(req.validated.query)),
);
