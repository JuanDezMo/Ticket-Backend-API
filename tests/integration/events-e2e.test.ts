import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer } from '../helpers/auth.js';
import { eventBody } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

// Flujo completo: ADMIN crea un evento de 25 puestos -> lista pública -> USER consulta seats
describe('events-seats end to end', () => {
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
    const admin = await request(ctx.app)
      .post('/auth/login')
      .send({ email: 'root@mail.com', password: 'seed-password-1' });
    const created = await request(ctx.app)
      .post('/events')
      .set(...bearer(admin.body.accessToken))
      .send(eventBody({ capacity: 25 }));
    expect(created.status).toBe(201);

    const publicList = await request(ctx.app).get('/events');
    expect(publicList.status).toBe(200);
    expect(publicList.body.data.map((e: { id: string }) => e.id)).toContain(created.body.id);

    await request(ctx.app)
      .post('/auth/register')
      .send({ email: 'ana@mail.com', password: 'password-123' });
    const user = await request(ctx.app)
      .post('/auth/login')
      .send({ email: 'ana@mail.com', password: 'password-123' });
    const seats = await request(ctx.app)
      .get(`/events/${created.body.id}/seats`)
      .query({ status: 'AVAILABLE' })
      .set(...bearer(user.body.accessToken));

    const labels = seats.body.data.map((s: { label: string }) => s.label);
    expect(labels).toHaveLength(25);
    expect(labels[0]).toBe('A1');
    expect(labels[10]).toBe('B1');
    expect(labels[24]).toBe('C5');
  });
});
