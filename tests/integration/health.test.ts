import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { buildContainer } from '../../src/container.js';
import { createDatabase } from '../../src/db/database.js';
import { createLogger } from '../../src/shared/logger.js';
import { createTestContext, testEnv, type TestContext } from '../helpers/test-app.js';

describe('GET /health', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('returns 200 UP without authentication when the database is reachable', async () => {
    const res = await request(ctx.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'UP' });
  });

  it('returns 503 DOWN when the database is not reachable', async () => {
    const env = testEnv();
    // Puerto cerrado: simula la BD detenida
    const brokenDb = createDatabase('postgres://x:x@127.0.0.1:1/none');
    const app = createApp(buildContainer(env, brokenDb, createLogger('silent')));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'DOWN' });
    await brokenDb.destroy();
  });

  it('returns 404 NOT_FOUND for an unknown route', async () => {
    const res = await request(ctx.app).get('/unknown');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
