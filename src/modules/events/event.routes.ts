import { Router, type RequestHandler } from 'express';
import { requireRole } from '../../shared/middleware/require-role.js';
import { validate } from '../../shared/middleware/validate.js';
import { ROLES } from '../../shared/security/roles.js';
import type { EventController } from './event.controller.js';
import { createEventSchema, listEventsQuerySchema } from './event.schemas.js';

export function createEventRoutes(
  controller: EventController,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  // Público: no exige autenticación
  router.get('/', validate(listEventsQuerySchema, 'query'), controller.list);
  router.post(
    '/',
    authenticate,
    requireRole(ROLES.ADMIN),
    validate(createEventSchema(() => new Date())),
    controller.create,
  );
  return router;
}
