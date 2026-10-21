import type { Migration } from 'kysely/migration';
import * as createUsers from './001-create-users.js';

// Las migraciones se registran de forma estática para que funcionen igual en tsx y en dist/
export const migrations: Record<string, Migration> = {
  '001-create-users': createUsers,
};
