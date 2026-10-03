import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { requirePermission } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import * as branchService from '../services/branchService.js';
import { sendCreated, sendSuccess } from '../utils/apiResponse.js';
import {
  booleanQuery,
  gstin,
  idParam,
  optionalText,
  pincode,
  requiredText,
  stateCode,
} from '../validators/common.js';

const branchSchema = z.object({
  code: requiredText(20, 'Code')
    .toUpperCase()
    .regex(/^[A-Z0-9-]+$/, 'Use capital letters, numbers or dash'),
  name: requiredText(150, 'Branch name'),
  address: optionalText(1000),
  city: optionalText(100),
  pincode,
  stateCode,
  phone: optionalText(30),
  gstin,
  isActive: z.boolean().optional(),
});

const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  isActive: booleanQuery,
});

export const branchRouter = Router();

// Branches the signed-in user may work in (for the branch selector).
branchRouter.get('/mine', (req, res) => sendSuccess(res, req.user.branches));

// Branch names are needed by anyone who requests a transfer, so listing only needs sign-in.
branchRouter.get('/', validate({ query: listSchema }), async (req, res) =>
  sendSuccess(res, await branchService.list(req.validated.query)),
);

branchRouter.get(
  '/:id',
  requirePermission(P.BRANCHES_MANAGE),
  validate({ params: idParam }),
  async (req, res) => sendSuccess(res, await branchService.getById(req.validated.params.id)),
);

branchRouter.post(
  '/',
  requirePermission(P.BRANCHES_MANAGE),
  validate({ body: branchSchema }),
  async (req, res) =>
    sendCreated(res, await branchService.create(req.validated.body, req.context), 'Branch created'),
);

branchRouter.patch(
  '/:id',
  requirePermission(P.BRANCHES_MANAGE),
  validate({ params: idParam, body: branchSchema.partial() }),
  async (req, res) =>
    sendSuccess(
      res,
      await branchService.update(req.validated.params.id, req.validated.body, req.context),
      { message: 'Branch updated' },
    ),
);
