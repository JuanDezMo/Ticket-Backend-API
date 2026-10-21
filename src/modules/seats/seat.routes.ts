import { Router, type RequestHandler } from 'express';
import { validate } from '../../shared/middleware/validate.js';
import type { SeatController } from './seat.controller.js';
import { eventIdParamsSchema, seatsQuerySchema } from './seat.schemas.js';

/** Se monta en /events/:id/seats. */
export function createSeatRoutes(controller: SeatController, authenticate: RequestHandler): Router {
  const router = Router({ mergeParams: true });
  router.get(
    '/',
    authenticate,
    validate(eventIdParamsSchema, 'params'),
    validate(seatsQuerySchema, 'query'),
    controller.listByEvent,
  );
  return router;
}
