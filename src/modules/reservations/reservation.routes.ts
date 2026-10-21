import { Router, type RequestHandler } from 'express';
import { requireRole } from '../../shared/middleware/require-role.js';
import { validate } from '../../shared/middleware/validate.js';
import { ROLES } from '../../shared/security/roles.js';
import type { ReservationController } from './reservation.controller.js';
import { createReservationSchema } from './reservation.schemas.js';

export function createReservationRoutes(
  controller: ReservationController,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.post(
    '/',
    authenticate,
    requireRole(ROLES.USER),
    validate(createReservationSchema),
    controller.create,
  );
  return router;
}
