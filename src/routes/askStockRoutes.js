import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { validate } from '../middleware/validate.js';
import * as askStock from '../services/askStock/askStockService.js';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../services/askStock/messages.js';
import { sendSuccess } from '../utils/apiResponse.js';

const language = z.enum(LANGUAGES);

const askSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Type a question')
    .max(300, 'Keep the question under 300 characters'),
  // Language of the answer; the question itself may be in any supported language.
  language: language.default(DEFAULT_LANGUAGE),
  context: z
    .object({ productId: z.coerce.number().int().positive().optional() })
    .nullish()
    .transform((v) => v ?? null),
});

const languageQuery = z.object({ language: language.default(DEFAULT_LANGUAGE) });
const preferencesSchema = z.object({ language });

// Each question runs a few queries; this keeps one user from flooding the database.
const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (req) => String(req.user.id),
  skip: () => env.isTest,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_QUESTIONS',
      message: 'Too many questions. Wait a minute and try again.',
    },
  },
});

/** Questions about a branch's stock (mounted behind `resolveBranch`). */
export const askStockRouter = Router();

// Each answer checks the permissions it needs (stock, prices, customers, sales).
askStockRouter.post('/', askLimiter, validate({ body: askSchema }), async (req, res) => {
  const { message, context, language: lang } = req.validated.body;
  sendSuccess(res, await askStock.answer(message, context, req.user, req.branch, lang));
});

/** Starter questions and the user's language; these do not depend on a branch. */
export const askStockSettingsRouter = Router();

askStockSettingsRouter.get('/suggestions', validate({ query: languageQuery }), (req, res) =>
  sendSuccess(res, askStock.suggestions(req.user, req.validated.query.language)),
);

askStockSettingsRouter.get('/preferences', async (req, res) =>
  sendSuccess(res, await askStock.getPreferences(req.user.id)),
);

askStockSettingsRouter.put(
  '/preferences',
  validate({ body: preferencesSchema }),
  async (req, res) =>
    sendSuccess(res, await askStock.savePreferences(req.user.id, req.validated.body)),
);
