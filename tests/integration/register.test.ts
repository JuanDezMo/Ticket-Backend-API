import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/shared/logger.js';
import { createLogCapture } from '../helpers/log-capture.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('POST /auth/register', () => {
  const capture = createLogCapture();
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext({}, {}, createLogger('trace', capture.stream));
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  const register = (body: object) => request(ctx.app).post('/auth/register').send(body);

  it('creates a USER and returns 201 without sensitive data', async () => {
    const res = await register({ email: 'ana@mail.com', password: 'password-123' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      email: 'ana@mail.com',
      role: 'USER',
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
  });

  it('stores the email in lowercase and only a hash of the password', async () => {
    await register({ email: 'Ana@Mail.com', password: 'password-123' });
    const row = await ctx.db.selectFrom('users').selectAll().executeTakeFirstOrThrow();
    expect(row.email).toBe('ana@mail.com');
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain('password-123');
  });

  it('returns 409 EMAIL_ALREADY_EXISTS for a repeated email, even with other casing', async () => {
    await register({ email: 'ana@mail.com', password: 'password-123' });
    const same = await register({ email: 'ana@mail.com', password: 'password-123' });
    const upper = await register({ email: 'Ana@Mail.com', password: 'password-123' });
    expect(same.status).toBe(409);
    expect(same.body.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(upper.status).toBe(409);
    expect(await ctx.db.selectFrom('users').selectAll().execute()).toHaveLength(1);
  });

  it('handles concurrent registrations of the same email', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        register({ email: 'race@mail.com', password: 'password-123' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
  });

  it.each([
    ['a short password', { email: 'a@mail.com', password: 'short' }],
    ['an invalid email', { email: 'not-an-email', password: 'password-123' }],
    ['a missing password', { email: 'a@mail.com' }],
    ['the role field', { email: 'a@mail.com', password: 'password-123', role: 'ADMIN' }],
  ])('returns 400 VALIDATION_ERROR for %s', async (_name, body) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await ctx.db.selectFrom('users').selectAll().execute()).toHaveLength(0);
  });

  it('never logs the password', async () => {
    await register({ email: 'log@mail.com', password: 'a-very-unique-password-xyz' });
    expect(capture.text()).not.toContain('a-very-unique-password-xyz');
  });
});
