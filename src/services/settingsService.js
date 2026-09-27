import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { AUDIT_ACTION, AUDIT_MODULE } from '../constants/audit.js';
import { STATE_NAME_BY_CODE } from '../constants/masterData.js';
import * as settingsRepository from '../repositories/settingsRepository.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import * as auditService from './auditService.js';

/** Public URL path for the stored logo, served by express.static at /uploads. */
function withLogoUrl(settings) {
  return { ...settings, logoUrl: settings.logoPath ? `/uploads/${settings.logoPath}` : null };
}

export async function getSettings(trx) {
  return withLogoUrl(await settingsRepository.get(trx));
}

/** Validates GSTIN / state code / PAN consistency against the values that will be saved. */
function validateTaxIdentity(merged) {
  const { gstin, stateCode, pan } = merged;
  const issues = [];
  if (stateCode && !STATE_NAME_BY_CODE[stateCode]) {
    issues.push({ field: 'stateCode', message: 'Unknown state code' });
  }
  if (gstin && stateCode && gstin.slice(0, 2) !== stateCode) {
    issues.push({
      field: 'stateCode',
      message: 'State code must match the first 2 digits of the GSTIN',
    });
  }
  if (gstin && pan && gstin.slice(2, 12) !== pan) {
    issues.push({ field: 'pan', message: 'PAN must match characters 3-12 of the GSTIN' });
  }
  if (issues.length) throw ApiError.validation(issues);
}

export async function updateSettings(data, context) {
  return db.transaction(async (trx) => {
    const before = await settingsRepository.get(trx);
    const merged = { ...before };
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) merged[key] = value;
    }
    validateTaxIdentity(merged);

    const changes = { ...data };
    if (data.stateCode !== undefined) {
      changes.state = data.stateCode ? STATE_NAME_BY_CODE[data.stateCode] : null;
    }
    await settingsRepository.update(changes, context.userId, trx);
    const after = await settingsRepository.get(trx);
    await auditService.log(
      context,
      {
        action: AUDIT_ACTION.UPDATE,
        module: AUDIT_MODULE.SETTINGS,
        recordId: 1,
        oldValue: before,
        newValue: after,
      },
      trx,
    );
    return withLogoUrl(after);
  });
}

async function removeFile(fileName) {
  if (!fileName) return;
  try {
    await fs.unlink(path.resolve(env.UPLOAD_DIR, fileName));
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn({ err }, 'Could not delete old logo');
  }
}

/** Stores a newly uploaded logo (already written to disk by multer) and deletes the previous one. */
export async function updateLogo(fileName, context) {
  const before = await settingsRepository.get();
  try {
    await db.transaction(async (trx) => {
      await settingsRepository.update({ logoPath: fileName }, context.userId, trx);
      await auditService.log(
        context,
        {
          action: AUDIT_ACTION.UPDATE,
          module: AUDIT_MODULE.SETTINGS,
          recordId: 1,
          oldValue: { logoPath: before.logoPath },
          newValue: { logoPath: fileName },
        },
        trx,
      );
    });
  } catch (err) {
    await removeFile(fileName);
    throw err;
  }
  await removeFile(before.logoPath);
  return getSettings();
}

export async function removeLogo(context) {
  const before = await settingsRepository.get();
  if (!before.logoPath) return getSettings();
  await settingsRepository.update({ logoPath: null }, context.userId);
  await removeFile(before.logoPath);
  return getSettings();
}

/** Absolute path of the logo on disk, for embedding in PDFs. */
export function logoFilePath(logoPath) {
  return logoPath ? path.resolve(env.UPLOAD_DIR, logoPath) : null;
}
