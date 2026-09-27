import { ApiError } from '../utils/ApiError.js';

function formatIssues(issues) {
  return issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.message,
  }));
}

/**
 * Validates request parts against zod schemas and stores the parsed (coerced, defaulted)
 * values on `req.validated`. Express 5 makes `req.query` read-only, so parsed values
 * are never written back onto the request itself.
 *
 * @param {{ body?: import('zod').ZodType, query?: import('zod').ZodType, params?: import('zod').ZodType }} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.validated = req.validated ?? {};
    const issues = [];
    for (const [part, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        req.validated[part] = result.data;
      } else {
        issues.push(...formatIssues(result.error.issues));
      }
    }
    if (issues.length) return next(ApiError.validation(issues));
    return next();
  };
}
