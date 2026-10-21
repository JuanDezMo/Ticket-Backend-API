import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer } from '../helpers/auth.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

// Flujo completo: seed del ADMIN -> login -> ADMIN crea usuarios -> registro público -> ruta protegida
describe('auth-users end to end', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext({
      SEED_ADMIN_EMAIL: 'root@mail.com',
      SEED_ADMIN_PASSWORD: 'seed-password-1',
    });
    await ctx.reset();
    await ctx.container.adminSeeder.seed();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('runs the whole flow', async () => {
    const adminLogin = await request(ctx.app)
      .post('/auth/login')
      .send({ email: 'root@mail.com', password: 'seed-password-1' });
    expect(adminLogin.status).toBe(200);
    const adminToken = adminLogin.body.accessToken as string;

    const secondAdmin = await request(ctx.app)
      .post('/users')
      .set(...bearer(adminToken))
      .send({ email: 'boss2@mail.com', password: 'password-123', role: 'ADMIN' });
    expect(secondAdmin.status).toBe(201);
    expect(secondAdmin.body.role).toBe('ADMIN');

    const register = await request(ctx.app)
      .post('/auth/register')
      .send({ email: 'ana@mail.com', password: 'password-123' });
    expect(register.status).toBe(201);
    expect(register.body.role).toBe('USER');

    const userLogin = await request(ctx.app)
      .post('/auth/login')
      .send({ email: 'ana@mail.com', password: 'password-123' });
    const userToken = userLogin.body.accessToken as string;

    const forbidden = await request(ctx.app)
      .post('/users')
      .set(...bearer(userToken))
      .send({ email: 'x@mail.com', password: 'password-123', role: 'USER' });
    expect(forbidden.status).toBe(403);

    const publicRegisterAsAdmin = await request(ctx.app)
      .post('/auth/register')
      .send({ email: 'evil@mail.com', password: 'password-123', role: 'ADMIN' });
    expect(publicRegisterAsAdmin.status).toBe(400);

    expect((await request(ctx.app).get('/health')).body).toEqual({ status: 'UP' });
  });
});
