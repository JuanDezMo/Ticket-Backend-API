import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserAndLogin, PASSWORD } from '../helpers/auth.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('POST /auth/login', () => {
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

  const login = (body: object) => request(ctx.app).post('/auth/login').send(body);

  it('returns 200 with a Bearer token carrying sub and role', async () => {
    await createUserAndLogin(ctx.app, ctx.db, 'ADMIN', 'boss@mail.com');
    const res = await login({ email: 'boss@mail.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    const decoded = jwt.decode(res.body.accessToken) as jwt.JwtPayload;
    const user = await ctx.db.selectFrom('users').select('id').executeTakeFirstOrThrow();
    expect(decoded.sub).toBe(user.id);
    expect(decoded.role).toBe('ADMIN');
  });

  it('accepts the email regardless of casing', async () => {
    await createUserAndLogin(ctx.app, ctx.db, 'USER', 'ana@mail.com');
    const res = await login({ email: 'ANA@mail.com', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('returns the same 401 for a wrong password and an unknown email', async () => {
    await createUserAndLogin(ctx.app, ctx.db, 'USER', 'ana@mail.com');
    const wrongPassword = await login({ email: 'ana@mail.com', password: 'wrong-password' });
    const unknownEmail = await login({ email: 'nobody@mail.com', password: PASSWORD });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('returns 400 VALIDATION_ERROR for a missing field', async () => {
    const res = await login({ email: 'ana@mail.com' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
