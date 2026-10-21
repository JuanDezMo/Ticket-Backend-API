import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer } from '../helpers/auth.js';
import { eventBody, expireReservations } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

// Flujo: ADMIN crea evento -> USER reserva A1 -> otro USER recibe 409 -> vence -> el otro USER reserva
describe('reservations end to end', () => {
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
  const register = (email: string) =>
    request(ctx.app).post('/auth/register').send({ email, password: 'password-123' });

  it('runs the whole flow', async () => {
    const admin = await login('root@mail.com', 'seed-password-1');
    const event = await request(ctx.app)
      .post('/events')
      .set(...bearer(admin))
      .send(eventBody({ capacity: 20, price: 80000 }));
    expect(event.status).toBe(201);
    const eventId = event.body.id as string;

    await register('ana@mail.com');
    await register('luis@mail.com');
    const ana = await login('ana@mail.com', 'password-123');
    const luis = await login('luis@mail.com', 'password-123');
    const reserve = (token: string, seat: string) =>
      request(ctx.app)
        .post('/reservations')
        .set(...bearer(token))
        .send({ eventId, seat });
    const available = async () =>
      (
        await request(ctx.app)
          .get(`/events/${eventId}/seats`)
          .query({ status: 'AVAILABLE' })
          .set(...bearer(luis))
      ).body.data.length;

    expect(await available()).toBe(20);

    const first = await reserve(ana, 'A1');
    expect(first.status).toBe(201);
    expect(first.body.amount).toBe(80000);
    expect(await available()).toBe(19);
    const detail = async () =>
      (
        await request(ctx.app)
          .get(`/reservations/${first.body.id}`)
          .set(...bearer(ana))
      ).body.status;
    expect(await detail()).toBe('ACTIVE');

    const taken = await reserve(luis, 'A1');
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('SEAT_NOT_AVAILABLE');

    await expireReservations(ctx.db, first.body.seatId);
    expect(await available()).toBe(20); // el listado libera la reserva vencida
    expect(await detail()).toBe('EXPIRED');

    const second = await reserve(luis, 'A1');
    expect(second.status).toBe(201);
    expect(await available()).toBe(19);

    // luis se arrepiente: cancela, el seat se libera al instante y ana lo vuelve a reservar
    const cancelled = await request(ctx.app)
      .post(`/reservations/${second.body.id}/cancel`)
      .set(...bearer(luis));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED_BY_USER');
    expect(await available()).toBe(20);
    expect((await reserve(ana, 'A1')).status).toBe(201);
  });
});
