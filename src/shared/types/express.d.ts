import type { Role } from '../security/roles.js';

declare global {
  namespace Express {
    interface Request {
      // Identidad tomada del token, nunca del cuerpo de la solicitud
      auth?: { userId: string; role: Role };
    }
  }
}

export {};
