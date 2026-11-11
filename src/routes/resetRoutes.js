import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import * as resetService from '../services/resetService.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** Reset Everything: Admin only (data.reset), every step checked again on the server. */
export const resetRouter = Router();
resetRouter.use(requirePermission(P.DATA_RESET));

const scopeList = z.array(z.string().trim().min(1).max(40)).min(1, 'Select what to reset').max(20);

const scopesQuery = z.object({
  scopes: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])),
});

const resetBody = z.object({
  scopes: scopeList,
  phrase: z.string().max(40),
  password: z.string().min(1, 'Enter your password').max(200),
  backupId: z.uuid().optional(),
  skipBackup: z.boolean().default(false),
});

// What can be reset, and what is always kept.
resetRouter.get('/', (_req, res) => sendSuccess(res, resetService.describe()));

// Exactly what a reset of the chosen groups would remove (row counts); changes nothing.
resetRouter.get('/preview', validate({ query: scopesQuery }), async (req, res) =>
  sendSuccess(res, await resetService.preview(req.validated.query.scopes)),
);

// Backup file of those rows. The backup id in the header is what the reset checks.
resetRouter.get('/backup', validate({ query: scopesQuery }), async (req, res) => {
  const { backupId, file } = await resetService.createBackup(
    req.validated.query.scopes,
    req.user,
    req.context,
  );
  res.setHeader('X-Backup-Id', backupId);
  res.setHeader('Access-Control-Expose-Headers', 'X-Backup-Id, Content-Disposition');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="jcb-backup-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  res.type('application/json').send(JSON.stringify(file));
});

resetRouter.post('/', validate({ body: resetBody }), async (req, res) =>
  sendSuccess(res, await resetService.reset(req.validated.body, req.user, req.context), {
    message: 'Selected data has been reset',
  }),
);
