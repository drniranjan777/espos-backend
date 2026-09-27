import * as settingsService from '../services/settingsService.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function get(_req, res) {
  return sendSuccess(res, await settingsService.getSettings());
}

export async function update(req, res) {
  const settings = await settingsService.updateSettings(req.validated.body, req.context);
  return sendSuccess(res, settings, { message: 'Settings saved' });
}

export async function uploadLogo(req, res) {
  if (!req.file) throw ApiError.badRequest('Choose an image to upload');
  const settings = await settingsService.updateLogo(req.file.filename, req.context);
  return sendSuccess(res, settings, { message: 'Logo updated' });
}

export async function removeLogo(req, res) {
  return sendSuccess(res, await settingsService.removeLogo(req.context), {
    message: 'Logo removed',
  });
}
