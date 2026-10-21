import type { Logger } from '../../shared/logger.js';
import { ROLES } from '../../shared/security/roles.js';
import type { UserService } from './user.service.js';

export interface SeedCredentials {
  email?: string;
  password?: string;
}

export type SeedResult = 'created' | 'skipped-existing-admin' | 'skipped-missing-config';

/** Crea el primer ADMIN al arrancar. Es idempotente: si ya existe un ADMIN no hace nada. */
export class AdminSeeder {
  constructor(
    private readonly userService: UserService,
    private readonly credentials: SeedCredentials,
    private readonly logger: Logger,
  ) {}

  async seed(): Promise<SeedResult> {
    if (await this.userService.hasUserWithRole(ROLES.ADMIN)) return 'skipped-existing-admin';

    const { email, password } = this.credentials;
    if (!email || !password) {
      this.logger.warn(
        'No ADMIN user exists and SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are not set; skipping admin seed',
      );
      return 'skipped-missing-config';
    }

    await this.userService.createUser({ email, password, role: ROLES.ADMIN });
    this.logger.info({ email }, 'Seed ADMIN user created');
    return 'created';
  }
}
