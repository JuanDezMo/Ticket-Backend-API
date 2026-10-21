import { AppError } from '../../shared/errors/index.js';
import type { Role } from '../../shared/security/roles.js';
import type { PasswordHasher } from '../../shared/security/password-hasher.js';
import { isUniqueViolation } from '../../shared/utils/db-errors.js';
import type { UserRepository } from './user.repository.js';
import type { PublicUser, User } from './user.types.js';

export interface CreateUserInput {
  email: string;
  password: string;
  role: Role;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async createUser({ email, password, role }: CreateUserInput): Promise<User> {
    const passwordHash = await this.hasher.hash(password);
    try {
      return await this.users.create({ email: normalizeEmail(email), passwordHash, role });
    } catch (error) {
      // El índice único de la BD cubre también las solicitudes concurrentes
      if (isUniqueViolation(error)) throw new AppError('EMAIL_ALREADY_EXISTS');
      throw error;
    }
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(normalizeEmail(email));
  }

  hasUserWithRole(role: Role): Promise<boolean> {
    return this.users.existsWithRole(role);
  }
}
