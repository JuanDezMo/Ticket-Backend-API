import express, { type Express } from 'express';
import type { Container } from './container.js';
import { errorHandler, notFoundHandler } from './shared/middleware/error-handler.js';
import { createAuthRoutes } from './modules/auth/auth.routes.js';
import { createHealthRoutes } from './modules/health/health.routes.js';
import { createUserRoutes } from './modules/users/user.routes.js';
import { createEventRoutes } from './modules/events/event.routes.js';
import { createSeatRoutes } from './modules/seats/seat.routes.js';

export function createApp(container: Container): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', createHealthRoutes(container.healthController));
  app.use('/auth', createAuthRoutes(container.authController));
  app.use('/users', createUserRoutes(container.userController, container.authenticate));
  app.use('/events', createEventRoutes(container.eventController, container.authenticate));
  app.use('/events/:id/seats', createSeatRoutes(container.seatController, container.authenticate));

  app.use(notFoundHandler);
  app.use(errorHandler(container.logger));
  return app;
}
