import { Router } from 'express';
import * as c from '../controllers/settingsController.js';
import { INDIAN_STATES } from '../constants/masterData.js';
import { PERMISSIONS as P } from '../constants/permissions.js';
import { requirePermission } from '../middleware/role.js';
import { logoUpload } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { updateSettingsSchema } from '../validators/settingsValidators.js';

export const settingsRouter = Router();

// Company details are shown on invoices, so every signed-in user can read them.
settingsRouter.get('/company', c.get);
settingsRouter.put(
  '/company',
  requirePermission(P.SETTINGS_MANAGE),
  validate({ body: updateSettingsSchema }),
  c.update,
);
settingsRouter.post(
  '/company/logo',
  requirePermission(P.SETTINGS_MANAGE),
  logoUpload,
  c.uploadLogo,
);
settingsRouter.delete('/company/logo', requirePermission(P.SETTINGS_MANAGE), c.removeLogo);

// Reference list of Indian states and GST state codes for dropdowns.
settingsRouter.get('/states', (_req, res) => sendSuccess(res, INDIAN_STATES));
