import { Router, type RequestHandler } from 'express';
import { requireRole } from '../../shared/middleware/require-role.js';
import { validate } from '../../shared/middleware/validate.js';
import { ROLES } from '../../shared/security/roles.js';
import type { CancellationController } from './cancellation.controller.js';
import { cancelEventParamsSchema } from './cancellation.schemas.js';

/** Se monta en /events/:id/cancel. */
export function createCancellationRoutes(
  controller: CancellationController,
  authenticate: RequestHandler,
): Router {
  const router = Router({ mergeParams: true });
  router.post(
    '/',
    authenticate,
    requireRole(ROLES.ADMIN),
    validate(cancelEventParamsSchema, 'params'),
    controller.cancel,
  );
  return router;
}
