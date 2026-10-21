import { Router, type RequestHandler } from 'express';
import { requireRole } from '../../shared/middleware/require-role.js';
import { validate } from '../../shared/middleware/validate.js';
import { ROLES } from '../../shared/security/roles.js';
import { paginationSchema } from '../../shared/utils/pagination.js';
import type { TicketController } from './ticket.controller.js';
import { purchaseSchema } from './ticket.schemas.js';

export function createTicketRoutes(
  controller: TicketController,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.post(
    '/purchase',
    authenticate,
    requireRole(ROLES.USER),
    validate(purchaseSchema),
    controller.purchase,
  );
  router.get(
    '/me',
    authenticate,
    requireRole(ROLES.USER),
    validate(paginationSchema, 'query'),
    controller.listMine,
  );
  return router;
}
