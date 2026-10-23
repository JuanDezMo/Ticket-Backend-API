import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer } from '../helpers/auth.js';
import { eventBody } from '../helpers/events.js';
import { createGatewayMock, gatewayExamples } from '../helpers/gateway-mock.js';
import { CARD, purchaseBody } from '../helpers/purchase.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

// Flujo: ADMIN crea evento -> USER reserva -> pago rechazado -> pago exitoso -> mis tickets
//        -> repetir la compra -> ADMIN cancela el evento -> el ticket queda cancelado
describe('ticket purchase end to end', () => {
  const gateway = createGatewayMock();
  let ctx: TestContext;

  beforeAll(async () => {
    gateway.start();
    ctx = await createTestContext({
      SEED_ADMIN_EMAIL: 'root@mail.com',
      SEED_ADMIN_PASSWORD: 'seed-password-1',
    });
    await ctx.reset();
    await ctx.container.adminSeeder.seed();
  });
  afterAll(async () => {
    gateway.stop();
    await ctx.close();
  });

  const login = async (email: string, password: string) =>
    (await request(ctx.app).post('/auth/login').send({ email, password })).body
      .accessToken as string;

  it('runs the whole flow', async () => {
    const admin = await login('root@mail.com', 'seed-password-1');
    const event = await request(ctx.app)
      .post('/events')
      .set(...bearer(admin))
      .send(eventBody({ capacity: 20, price: 80000 }));
    const eventId = event.body.id as string;

    await request(ctx.app)
      .post('/auth/register')
      .send({ email: 'ana@mail.com', password: 'password-123' });
    const ana = await login('ana@mail.com', 'password-123');
    const reservation = await request(ctx.app)
      .post('/reservations')
      .set(...bearer(ana))
      .send({ eventId, seats: ['A1'] });
    expect(reservation.status).toBe(201);
    const pay = () =>
      request(ctx.app)
        .post('/tickets/purchase')
        .set(...bearer(ana))
        .send(purchaseBody(reservation.body.reservations[0].id, CARD));

    // 1. tarjeta rechazada: no hay ticket y la reserva sigue activa
    gateway.respond(402, gatewayExamples.rejected);
    const rejected = await pay();
    expect(rejected.status).toBe(402);
    expect(rejected.body.code).toBe('PAYMENT_REJECTED');
    expect(
      (
        await request(ctx.app)
          .get('/tickets/me')
          .set(...bearer(ana))
      ).body.data,
    ).toEqual([]);

    // 2. otra tarjeta: se emite el ticket
    gateway.respond(200, gatewayExamples.approved);
    const ok = await pay();
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ orderId: expect.any(String), amount: 80000 });
    expect(ok.body.tickets).toHaveLength(1);
    expect(ok.body.tickets[0]).toMatchObject({
      seat: 'A1',
      status: 'ISSUED',
      amount: 80000,
      transactionId: gatewayExamples.approved.transactionId,
    });

    // 3. mis tickets
    const mine = await request(ctx.app)
      .get('/tickets/me')
      .set(...bearer(ana));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({
      id: ok.body.tickets[0].id,
      status: 'ISSUED',
      seat: 'A1',
    });

    // 4. repetir la compra es una posible duplicación: error, sin cobrar de nuevo
    const callsBefore = gateway.calls.length;
    const again = await pay();
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('DUPLICATE_PAYMENT');
    expect(gateway.calls.length).toBe(callsBefore);

    // 5. el seat vendido ya no está disponible
    const available = await request(ctx.app)
      .get(`/events/${eventId}/seats`)
      .query({ status: 'AVAILABLE' })
      .set(...bearer(ana));
    expect(available.body.data.map((s: { label: string }) => s.label)).not.toContain('A1');

    // 6. el ADMIN cancela el evento: el ticket queda cancelado y su pago pendiente de reembolso
    const cancelled = await request(ctx.app)
      .post(`/events/${eventId}/cancel`)
      .set(...bearer(admin));
    expect(cancelled.body).toEqual({
      id: eventId,
      status: 'CANCELLED',
      cancelledReservations: 0,
      cancelledTickets: 1,
    });
    const after = await request(ctx.app)
      .get('/tickets/me')
      .set(...bearer(ana));
    expect(after.body.data[0].status).toBe('CANCELLED_BY_EVENT');
    const payment = await ctx.db.selectFrom('payments').select('status').executeTakeFirstOrThrow();
    expect(payment.status).toBe('REFUND_PENDING');
  });
});
