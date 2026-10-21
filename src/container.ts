import type { Env } from './config/env.js';
import type { Db } from './db/database.js';
import type { Logger } from './shared/logger.js';
import { authenticate } from './shared/middleware/authenticate.js';
import { Argon2PasswordHasher, type PasswordHasher } from './shared/security/password-hasher.js';
import { JwtTokenService, type TokenService } from './shared/security/token-service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { HealthService } from './modules/health/health.service.js';
import { AdminSeeder } from './modules/users/admin-seeder.js';
import { UserController } from './modules/users/user.controller.js';
import { KyselyUserRepository } from './modules/users/user.repository.js';
import { UserService } from './modules/users/user.service.js';

export interface ContainerOverrides {
  hasher?: PasswordHasher;
  tokens?: TokenService;
}

/** Raíz de composición: único lugar donde se crean y conectan las instancias. */
export function buildContainer(
  env: Env,
  db: Db,
  logger: Logger,
  overrides: ContainerOverrides = {},
) {
  const hasher = overrides.hasher ?? new Argon2PasswordHasher();
  const tokens =
    overrides.tokens ?? new JwtTokenService(env.JWT_SECRET, env.JWT_EXPIRES_IN_SECONDS);

  const userService = new UserService(new KyselyUserRepository(db), hasher);
  const authService = new AuthService(userService, hasher, tokens);

  return {
    logger,
    authenticate: authenticate(tokens),
    authController: new AuthController(authService),
    userController: new UserController(userService),
    healthController: new HealthController(new HealthService(db)),
    adminSeeder: new AdminSeeder(
      userService,
      { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD },
      logger,
    ),
  };
}

export type Container = ReturnType<typeof buildContainer>;
