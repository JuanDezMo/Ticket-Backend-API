import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/shared/logger.js';
import { createLogCapture } from '../helpers/log-capture.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

const SEED = { SEED_ADMIN_EMAIL: 'root@mail.com', SEED_ADMIN_PASSWORD: 'seed-password-1' };

describe('AdminSeeder', () => {
  const capture = createLogCapture();
  const contexts: TestContext[] = [];

  const open = async (env: Record<string, string | undefined>) => {
    const ctx = await createTestContext(env, {}, createLogger('trace', capture.stream));
    contexts.push(ctx);
    return ctx;
  };

  beforeEach(async () => {
    const ctx = await open({});
    await ctx.reset();
    capture.lines.length = 0;
  });
  afterAll(async () => {
    await Promise.all(contexts.map((c) => c.close()));
  });

  it('creates the first ADMIN, who can log in with the seed password', async () => {
    const ctx = await open(SEED);
    expect(await ctx.container.adminSeeder.seed()).toBe('created');

    const login = await request(ctx.app)
      .post('/auth/login')
      .send({ email: SEED.SEED_ADMIN_EMAIL, password: SEED.SEED_ADMIN_PASSWORD });
    expect(login.status).toBe(200);

    const row = await ctx.db.selectFrom('users').selectAll().executeTakeFirstOrThrow();
    expect(row.role).toBe('ADMIN');
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(SEED.SEED_ADMIN_PASSWORD);
    expect(capture.text()).not.toContain(SEED.SEED_ADMIN_PASSWORD);
  });

  it('does nothing on restart, even if the variables changed', async () => {
    const first = await open(SEED);
    await first.container.adminSeeder.seed();

    const second = await open({
      SEED_ADMIN_EMAIL: 'other@mail.com',
      SEED_ADMIN_PASSWORD: 'other-password-1',
    });
    expect(await second.container.adminSeeder.seed()).toBe('skipped-existing-admin');

    const users = await second.db.selectFrom('users').selectAll().execute();
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe(SEED.SEED_ADMIN_EMAIL);
  });

  it('continues with a warning when there is no ADMIN and no variables', async () => {
    const ctx = await open({});
    expect(await ctx.container.adminSeeder.seed()).toBe('skipped-missing-config');
    expect(await ctx.db.selectFrom('users').selectAll().execute()).toHaveLength(0);
    expect(capture.text()).toContain('"level":40');
    expect(capture.text()).toContain('SEED_ADMIN_EMAIL');
  });

  it('does not create an ADMIN if one already exists', async () => {
    const ctx = await open(SEED);
    await ctx.db
      .insertInto('users')
      .values({ email: 'existing@mail.com', password_hash: 'x', role: 'ADMIN' })
      .execute();
    expect(await ctx.container.adminSeeder.seed()).toBe('skipped-existing-admin');
  });
});
