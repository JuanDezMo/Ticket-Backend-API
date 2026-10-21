import { Router, type RequestHandler } from 'express';
import { requireRole } from '../../shared/middleware/require-role.js';
import { validate } from '../../shared/middleware/validate.js';
import { ROLES } from '../../shared/security/roles.js';
import type { ReservationController } from './reservation.controller.js';
import { createReservationSchema, reservationIdParamsSchema } from './reservation.schemas.js';

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
  // authenticate antes de requireRole: sin token responde 401, no 403
  router.get(
    '/:id',
    authenticate,
    requireRole(ROLES.USER),
    validate(reservationIdParamsSchema, 'params'),
    controller.getById,
  );
  router.post(
    '/:id/cancel',
    authenticate,
    requireRole(ROLES.USER),
    validate(reservationIdParamsSchema, 'params'),
    controller.cancel,
  );
  return router;
}
