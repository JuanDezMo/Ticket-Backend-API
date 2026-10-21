import type { RequestHandler } from 'express';
import { AppError } from '../errors/index.js';
import type { TokenService } from '../security/token-service.js';

const BEARER_PREFIX = 'Bearer ';

export function authenticate(tokenService: TokenService): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith(BEARER_PREFIX)) throw new AppError('UNAUTHORIZED');

    const payload = tokenService.verify(header.slice(BEARER_PREFIX.length).trim());
    if (!payload) throw new AppError('UNAUTHORIZED');

    req.auth = payload;
    next();
  };
}
