import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats } from '../helpers/events.js';
import { createGatewayMock } from '../helpers/gateway-mock.js';
import { purchaseBody, reserveSeat } from '../helpers/purchase.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('event cancellation with sold tickets', () => {
  const gateway = createGatewayMock();
  let ctx: TestContext;
  let adminToken: string;

  beforeAll(async () => {
    gateway.start();
    ctx = await createTestContext();
  });
  afterAll(async () => {
    gateway.stop();
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    adminToken = (await createUserAndLogin(ctx.app, ctx.db, 'ADMIN')).token;
  });
  afterEach(() => gateway.reset());

  async function buy(eventId: string, email: string, seat: string, txn: string) {
    gateway.respond(200, { status: 'APPROVED', transactionId: txn });
    const { token, reservation } = await reserveSeat(ctx.app, ctx.db, { email, seat, eventId });
    const res = await request(ctx.app)
      .post('/tickets/purchase')
      .set(...bearer(token))
      .send(purchaseBody(reservation.id));
    expect(res.status).toBe(201);
    return { token, ticketId: res.body.id as string };
  }
  const cancel = (id: string) =>
    request(ctx.app)
      .post(`/events/${id}/cancel`)
      .set(...bearer(adminToken));

  it('cancels the tickets, marks their payments REFUND_PENDING and reports cancelledTickets', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 20 });
    const other = await insertEventWithSeats(ctx.db, { capacity: 20 });
    const a = await buy(event.id, 'a@mail.com', 'A1', 'txn-a');
    await buy(event.id, 'b@mail.com', 'A2', 'txn-b');
    await buy(event.id, 'c@mail.com', 'A3', 'txn-c');
    const unrelated = await buy(other.id, 'd@mail.com', 'A1', 'txn-d');
    // una reserva ACTIVE sin pagar en el mismo evento
    await reserveSeat(ctx.app, ctx.db, { email: 'e@mail.com', seat: 'A4', eventId: event.id });

    const res = await cancel(event.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: event.id,
      status: 'CANCELLED',
      cancelledReservations: 1,
      cancelledTickets: 3,
    });

    const tickets = await ctx.db.selectFrom('tickets').select(['event_id', 'status']).execute();
    expect(
      tickets
        .filter((t) => t.event_id === event.id)
        .every((t) => t.status === 'CANCELLED_BY_EVENT'),
    ).toBe(true);
    expect(tickets.find((t) => t.event_id === other.id)?.status).toBe('ISSUED');

    const payments = await ctx.db.selectFrom('payments').select(['event_id', 'status']).execute();
    expect(payments.filter((p) => p.event_id === event.id).map((p) => p.status)).toEqual([
      'REFUND_PENDING',
      'REFUND_PENDING',
      'REFUND_PENDING',
    ]);
    expect(payments.find((p) => p.event_id === other.id)?.status).toBe('APPROVED');

    // los tickets siguen existiendo y se ven como cancelados
    const mine = await request(ctx.app)
      .get('/tickets/me')
      .set(...bearer(a.token));
    expect(mine.body.data[0]).toMatchObject({ id: a.ticketId, status: 'CANCELLED_BY_EVENT' });
    const unaffected = await request(ctx.app)
      .get('/tickets/me')
      .set(...bearer(unrelated.token));
    expect(unaffected.body.data[0].status).toBe('ISSUED');
  });

  it('keeps cancelledTickets at 0 for an event without tickets', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const res = await cancel(event.id);
    expect(res.body.cancelledTickets).toBe(0);
  });
});
