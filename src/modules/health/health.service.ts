import { sql } from 'kysely';
import type { Db } from '../../db/database.js';

export class HealthService {
  constructor(private readonly db: Db) {}

  async isDatabaseUp(): Promise<boolean> {
    try {
      await sql`select 1`.execute(this.db);
      return true;
    } catch {
      return false;
    }
  }
}
