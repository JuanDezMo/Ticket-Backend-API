import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../errors/index.js';

type Target = 'body' | 'query' | 'params';

/**
 * Valida la entrada con zod antes de llegar al controller.
 * El body validado reemplaza a req.body; query y params quedan en res.locals
 * porque en Express 5 req.query es de solo lectura.
 */
export function validate(schema: ZodType, target: Target = 'body'): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.join('.') || target}: ${issue.message}`)
        .join('; ');
      throw new AppError('VALIDATION_ERROR', detail);
    }
    if (target === 'body') req.body = result.data;
    else res.locals[target] = result.data;
    next();
  };
}
