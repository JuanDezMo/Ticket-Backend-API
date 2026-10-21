import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, ERROR_DEFINITIONS } from '../errors/index.js';
import type { Logger } from '../logger.js';

export const notFoundHandler: RequestHandler = () => {
  throw new AppError('NOT_FOUND');
};

function isBodyParseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type: unknown }).type === 'entity.parse.failed'
  );
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ code: error.code, message: error.message });
      return;
    }
    if (isBodyParseError(error)) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' });
      return;
    }
    // Error inesperado: el detalle va al log, nunca a la respuesta
    logger.error({ err: error }, 'Unhandled error');
    res
      .status(ERROR_DEFINITIONS.INTERNAL_ERROR.status)
      .json({ code: 'INTERNAL_ERROR', message: ERROR_DEFINITIONS.INTERNAL_ERROR.message });
  };
}
