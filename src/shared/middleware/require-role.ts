import type { RequestHandler } from 'express';
import { AppError } from '../errors/index.js';
import type { Role } from '../security/roles.js';

/** Debe usarse después de `authenticate`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new AppError('UNAUTHORIZED');
    if (!roles.includes(req.auth.role)) throw new AppError('FORBIDDEN');
    next();
  };
}
