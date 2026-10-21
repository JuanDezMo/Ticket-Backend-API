import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer } from '../helpers/auth.js';
import { eventBody } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

// Flujo: ADMIN crea evento -> dos USER reservan -> ADMIN cancela -> todo consistente
describe('event cancellation end to end', () => {
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

  const login = async (email: string, password: string) =>
    (await request(ctx.app).post('/auth/login').send({ email, password })).body
      .accessToken as string;

  it('runs the whole flow', async () => {
    const admin = await login('root@mail.com', 'seed-password-1');
    for (const email of ['ana@mail.com', 'luis@mail.com']) {
      await request(ctx.app).post('/auth/register').send({ email, password: 'password-123' });
    }
    const ana = await login('ana@mail.com', 'password-123');
    const luis = await login('luis@mail.com', 'password-123');

    const created = await request(ctx.app)
      .post('/events')
      .set(...bearer(admin))
      .send(eventBody({ capacity: 20 }));
    const eventId = created.body.id as string;
    const reserve = (token: string, seat: string) =>
      request(ctx.app)
        .post('/reservations')
        .set(...bearer(token))
        .send({ eventId, seat });

    expect((await reserve(ana, 'A1')).status).toBe(201);
    expect((await reserve(luis, 'A2')).status).toBe(201);

    const cancelled = await request(ctx.app)
      .post(`/events/${eventId}/cancel`)
      .set(...bearer(admin));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual({
      id: eventId,
      status: 'CANCELLED',
      cancelledReservations: 2,
      cancelledTickets: 0,
    });

    const reservations = await ctx.db.selectFrom('reservations').select('status').execute();
    expect(reservations.map((r) => r.status)).toEqual(['CANCELLED', 'CANCELLED']);

    const list = await request(ctx.app).get('/events');
    expect(list.body.data[0]).toMatchObject({ id: eventId, status: 'CANCELLED' });

    const afterReserve = await reserve(ana, 'B1');
    expect(afterReserve.status).toBe(409);
    expect(afterReserve.body.code).toBe('EVENT_NOT_ACTIVE');

    const again = await request(ctx.app)
      .post(`/events/${eventId}/cancel`)
      .set(...bearer(admin));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('EVENT_ALREADY_CANCELLED');

    const available = await request(ctx.app)
      .get(`/events/${eventId}/seats`)
      .query({ status: 'AVAILABLE' })
      .set(...bearer(ana));
    expect(available.body.data).toEqual([]);
  });
});
