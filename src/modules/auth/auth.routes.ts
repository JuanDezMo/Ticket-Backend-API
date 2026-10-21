import { Router } from 'express';
import { validate } from '../../shared/middleware/validate.js';
import type { AuthController } from './auth.controller.js';
import { loginSchema, registerSchema } from './auth.schemas.js';

export function createAuthRoutes(controller: AuthController): Router {
  const router = Router();
  router.post('/register', validate(registerSchema), controller.register);
  router.post('/login', validate(loginSchema), controller.login);
  return router;
}
