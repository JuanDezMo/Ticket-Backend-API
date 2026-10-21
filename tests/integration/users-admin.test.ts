import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin, PASSWORD } from '../helpers/auth.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('POST /users (ADMIN only)', () => {
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

  const create = (token: string | undefined, body: object) => {
    const req = request(ctx.app).post('/users');
    if (token) req.set(...bearer(token));
    return req.send(body);
  };

  it('lets an ADMIN create an ADMIN and a USER', async () => {
    const { token } = await createUserAndLogin(ctx.app, ctx.db, 'ADMIN');
    const admin = await create(token, { email: 'b@mail.com', password: PASSWORD, role: 'ADMIN' });
    const user = await create(token, { email: 'u@mail.com', password: PASSWORD, role: 'USER' });
    expect(admin.status).toBe(201);
    expect(admin.body.role).toBe('ADMIN');
    expect(user.status).toBe(201);
    expect(user.body.role).toBe('USER');
    expect(JSON.stringify(admin.body)).not.toMatch(/password|hash/i);
  });

  it('returns 401 without a token', async () => {
    const res = await create(undefined, { email: 'b@mail.com', password: PASSWORD, role: 'USER' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 with an expired token', async () => {
    const { token } = await createUserAndLogin(ctx.app, ctx.db, 'ADMIN');
    const { sub, role } = jwt.decode(token) as jwt.JwtPayload;
    const expired = jwt.sign(
      { role, exp: Math.floor(Date.now() / 1000) - 60 },
      ctx.env.JWT_SECRET,
      {
        subject: sub,
      },
    );
    const res = await create(expired, { email: 'b@mail.com', password: PASSWORD, role: 'USER' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with a tampered token', async () => {
    const { token } = await createUserAndLogin(ctx.app, ctx.db, 'ADMIN');
    const [header, payload] = token.split('.');
    const res = await create(`${header}.${payload}.tampered`, {
      email: 'b@mail.com',
      password: PASSWORD,
      role: 'USER',
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 FORBIDDEN for a USER and creates nothing', async () => {
    const { token } = await createUserAndLogin(ctx.app, ctx.db, 'USER');
    const res = await create(token, { email: 'b@mail.com', password: PASSWORD, role: 'ADMIN' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await ctx.db.selectFrom('users').selectAll().execute()).toHaveLength(1);
  });

  it.each([
    ['a missing role', { email: 'b@mail.com', password: PASSWORD }],
    ['an invalid role', { email: 'b@mail.com', password: PASSWORD, role: 'SUPERUSER' }],
  ])('returns 400 VALIDATION_ERROR for %s', async (_name, body) => {
    const { token } = await createUserAndLogin(ctx.app, ctx.db, 'ADMIN');
    const res = await create(token, body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 EMAIL_ALREADY_EXISTS for a repeated email', async () => {
    const { token } = await createUserAndLogin(ctx.app, ctx.db, 'ADMIN');
    await create(token, { email: 'b@mail.com', password: PASSWORD, role: 'USER' });
    const res = await create(token, { email: 'B@mail.com', password: PASSWORD, role: 'USER' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_EXISTS');
  });
});
