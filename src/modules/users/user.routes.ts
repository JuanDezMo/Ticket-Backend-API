import { Router, type RequestHandler } from 'express';
import { validate } from '../../shared/middleware/validate.js';
import { requireRole } from '../../shared/middleware/require-role.js';
import { ROLES } from '../../shared/security/roles.js';
import type { UserController } from './user.controller.js';
import { createUserSchema } from './user.schemas.js';

export function createUserRoutes(controller: UserController, authenticate: RequestHandler): Router {
  const router = Router();
  router.post(
    '/',
    authenticate,
    requireRole(ROLES.ADMIN),
    validate(createUserSchema),
    controller.create,
  );
  return router;
}
