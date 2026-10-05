import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { validate } from '../middleware/validate.js';
import { answer } from '../services/askStock/askStockService.js';
import { sendSuccess } from '../utils/apiResponse.js';

const askSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Type a question')
    .max(300, 'Keep the question under 300 characters'),
  context: z
    .object({ productId: z.coerce.number().int().positive().optional() })
    .nullish()
    .transform((v) => v ?? null),
});

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

export const askStockRouter = Router();

// Each answer checks the permissions it needs (stock, prices, customers, sales).
askStockRouter.post('/', askLimiter, validate({ body: askSchema }), async (req, res) =>
  sendSuccess(
    res,
    await answer(req.validated.body.message, req.validated.body.context, req.user, req.branch),
  ),
);
