import { Router } from 'express';
import type { HealthController } from './health.controller.js';

export function createHealthRoutes(controller: HealthController): Router {
  const router = Router();
  router.get('/', controller.check);
  return router;
}
