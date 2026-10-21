import request from 'supertest';
import type { Express } from 'express';
import type { Db } from '../../src/db/database.js';
import type { Role } from '../../src/shared/security/roles.js';
import { Argon2PasswordHasher } from '../../src/shared/security/password-hasher.js';

export const PASSWORD = 'password-123';

/** Inserta un usuario directamente en la BD y devuelve un token obtenido por login. */
export async function createUserAndLogin(
  app: Express,
  db: Db,
  role: Role,
  email = `${role.toLowerCase()}@mail.com`,
): Promise<{ token: string; email: string }> {
  const passwordHash = await new Argon2PasswordHasher().hash(PASSWORD);
  await db.insertInto('users').values({ email, password_hash: passwordHash, role }).execute();
  const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
  return { token: res.body.accessToken as string, email };
}

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}
