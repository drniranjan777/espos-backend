import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

// PNG and JPEG only: these are the formats the PDF generator can embed.
const IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg' };
const MAX_LOGO_BYTES = 1024 * 1024;

const uploadDir = path.resolve(env.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

/** Single image upload (field "logo"), stored with a random name so user input never becomes a path. */
export const logoUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) =>
      cb(null, `logo-${randomBytes(8).toString('hex')}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
    return cb(ApiError.badRequest('Logo must be a PNG or JPG image'));
  },
}).single('logo');
