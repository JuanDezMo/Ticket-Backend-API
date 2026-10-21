import { Migrator } from 'kysely/migration';
import type { Db } from './database.js';
import { migrations } from './migrations/index.js';

export async function migrateToLatest(db: Db): Promise<string[]> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error;
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
