import type { Selectable } from 'kysely';
import type { Db } from '../../db/database.js';
import type { Users } from '../../db/types.js';
import type { Role } from '../../shared/security/roles.js';
import type { NewUser, User } from './user.types.js';

export interface UserRepository {
  create(user: NewUser): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  existsWithRole(role: Role): Promise<boolean>;
}

type UserRow = Selectable<Users>;

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role as Role,
    createdAt: row.created_at,
  };
}

export class KyselyUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async create(user: NewUser): Promise<User> {
    const row = await this.db
      .insertInto('users')
      .values({ email: user.email, password_hash: user.passwordHash, role: user.role })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toUser(row);
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();
    return row ? toUser(row) : null;
  }

  async existsWithRole(role: Role): Promise<boolean> {
    const row = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', role)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }
}
