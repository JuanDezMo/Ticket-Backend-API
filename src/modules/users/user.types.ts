import type { Role } from '../../shared/security/roles.js';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  role: Role;
}

/** Vista pública del usuario: nunca incluye contraseña ni hash. */
export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
}
