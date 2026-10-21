import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest } from '../../src/db/migrate.js';
import { isUniqueViolation } from '../../src/shared/utils/db-errors.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('database schema', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  const insert = (email: string, role = 'USER') =>
    ctx.db.insertInto('users').values({ email, password_hash: 'hash', role }).execute();

  it('applies migrations idempotently', async () => {
    expect(await migrateToLatest(ctx.db)).toEqual([]);
    const tables = await sql<{ table_name: string }>`
      select table_name from information_schema.tables where table_schema = 'public'`.execute(
      ctx.db,
    );
    expect(tables.rows.map((r) => r.table_name)).toContain('users');
  });

  it('rejects a duplicated email with a unique violation', async () => {
    await insert('ana@mail.com');
    await expect(insert('ana@mail.com')).rejects.toSatisfy(isUniqueViolation);
  });

  it('rejects emails that are not lowercase', async () => {
    await expect(insert('Ana@Mail.com')).rejects.toThrow();
  });

  it('rejects an invalid role', async () => {
    await expect(insert('x@mail.com', 'SUPERUSER')).rejects.toThrow();
  });
});
