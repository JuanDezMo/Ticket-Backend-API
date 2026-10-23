import request from 'supertest';
import { HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gatewayIdFor } from '../../src/modules/tickets/ticket.service.js';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats } from '../helpers/events.js';
import { createGatewayMock, gatewayExamples } from '../helpers/gateway-mock.js';
import { CARD, purchaseBody } from '../helpers/purchase.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

interface Reserved {
  id: string;
  seatId: string;
  seat: string;
  amount: number;
}

describe('POST /tickets/purchase with several reservations', () => {
  const gateway = createGatewayMock();
  let ctx: TestContext;
  let seq = 0;

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
  });
  afterEach(() => gateway.reset());

  /** Un usuario con `count` reservas ACTIVE del mismo evento, reservadas en un solo lote. */
  async function group(
    count: number,
    options: { price?: number; eventId?: string; email?: string; from?: number } = {},
  ) {
    const { token, userId } = await createUserAndLogin(
      ctx.app,
      ctx.db,
      'USER',
      options.email ?? `buyer${++seq}@mail.com`,
    );
    const eventId =
      options.eventId ??
      (
        await insertEventWithSeats(ctx.db, {
          capacity: 30,
          max_seats_per_user: 8,
          price: options.price ?? 100,
        })
      ).id;
    // `from`: primer número de seat de la fila A, para dos grupos en el mismo evento
    const first = options.from ?? 1;
    const seats = Array.from({ length: count }, (_, i) => `A${first + i}`);
    const res = await request(ctx.app)
      .post('/reservations')
      .set(...bearer(token))
      .send({ eventId, seats });
    expect(res.status).toBe(201);
    return { token, userId, eventId, reservations: res.body.reservations as Reserved[] };
  }
  const pay = (token: string, ids: string[], card: Record<string, unknown> = CARD) =>
    request(ctx.app)
      .post('/tickets/purchase')
      .set(...bearer(token))
      .send(purchaseBody(ids, card));
  const count = async (table: 'tickets' | 'payments' | 'orders') =>
    (await ctx.db.selectFrom(table).selectAll().execute()).length;
  const statusesOf = async (ids: string[]) =>
    await ctx.db
      .selectFrom('reservations')
      .select(['id', 'status', 'payment_started_at'])
      .where('id', 'in', ids)
      .execute();
  const seatStatuses = async (ids: string[]) =>
    (await ctx.db.selectFrom('seats').select('status').where('id', 'in', ids).execute()).map(
      (s) => s.status,
    );

  describe.each([1, 3, 8])('a purchase of %i reservation(s)', (size) => {
    it('charges once for the sum, issues one ticket per reservation and records one order and payment', async () => {
      const { token, userId, reservations } = await group(size, { price: 12.5 });
      const ids = reservations.map((r) => r.id);

      const res = await pay(token, ids);

      expect(res.status).toBe(201);
      expect(res.body.amount).toBe(12.5 * size);
      expect(res.body.tickets).toHaveLength(size);
      expect(res.body.tickets.map((t: { reservationId: string }) => t.reservationId)).toEqual(ids);
      expect(
        new Set(res.body.tickets.map((t: { transactionId: string }) => t.transactionId)),
      ).toEqual(new Set([gatewayExamples.approved.transactionId]));
      expect(gateway.calls).toHaveLength(1);
      expect(gateway.calls[0]!.body).toMatchObject({ amount: 12.5 * size, card: CARD });
      expect(gateway.calls[0]!.body.reservationId).toBe(gatewayIdFor(ids));
      expect(await count('orders')).toBe(1);
      expect(await count('payments')).toBe(1);
      expect(await count('tickets')).toBe(size);
      const order = await ctx.db.selectFrom('orders').selectAll().executeTakeFirstOrThrow();
      expect(order).toMatchObject({ user_id: userId });
      expect(Number(order.amount)).toBe(12.5 * size);
      const rows = await ctx.db
        .selectFrom('reservations')
        .select(['status', 'order_id', 'payment_started_at'])
        .execute();
      expect(
        rows.every(
          (r) =>
            r.status === 'CONFIRMED' && r.order_id === order.id && r.payment_started_at === null,
        ),
      ).toBe(true);
      expect(await seatStatuses(reservations.map((r) => r.seatId))).toEqual(
        Array(size).fill('SOLD'),
      );
      const mine = await request(ctx.app)
        .get('/tickets/me')
        .set(...bearer(token));
      expect(mine.body.meta.total).toBe(size);
    });
  });

  it('sends the id of the reservation to the gateway when there is only one', async () => {
    const { token, reservations } = await group(1);
    await pay(token, [reservations[0]!.id]);
    expect(gateway.calls[0]!.body.reservationId).toBe(reservations[0]!.id);
  });

  it('sends the same gateway id whatever the order of the ids', async () => {
    const { token, reservations } = await group(3);
    const ids = reservations.map((r) => r.id);
    gateway.respond(502, gatewayExamples.gatewayError);
    await pay(token, ids);
    await pay(token, [...ids].reverse());
    expect(gateway.calls).toHaveLength(2);
    expect(gateway.calls[1]!.body.reservationId).toBe(gateway.calls[0]!.body.reservationId);
  });

  it('sends different gateway ids for two sets that share their lowest id', async () => {
    const { token, reservations } = await group(3);
    const [a, b, c] = reservations.map((r) => r.id) as [string, string, string];
    gateway.respond(502, gatewayExamples.gatewayError);
    await pay(token, [a, b]);
    await pay(token, [a, c]);
    expect(gateway.calls[0]!.body.reservationId).not.toBe(gateway.calls[1]!.body.reservationId);
  });

  describe('all or nothing before charging', () => {
    it('answers RESERVATION_EXPIRED when one reservation expired and charges nothing, leaving the others claimable', async () => {
      const { token, reservations } = await group(3);
      const ids = reservations.map((r) => r.id);
      await ctx.db
        .updateTable('reservations')
        .set({ expires_at: new Date(Date.now() - 60_000) })
        .where('id', '=', ids[1]!)
        .execute();

      const res = await pay(token, ids);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RESERVATION_EXPIRED');
      expect(gateway.calls).toHaveLength(0);
      const rows = await statusesOf(ids);
      expect(rows.every((r) => r.payment_started_at === null)).toBe(true);
      expect(await count('orders')).toBe(0);
      // Las vigentes se pueden pagar solas
      const ok = await pay(token, [ids[0]!, ids[2]!]);
      expect(ok.status).toBe(201);
    });

    it('answers FORBIDDEN for someone else’s reservation', async () => {
      const mine = await group(1);
      const theirs = await group(1, { eventId: mine.eventId, from: 2 });
      const res = await pay(mine.token, [mine.reservations[0]!.id, theirs.reservations[0]!.id]);
      expect(res.status).toBe(403);
      expect(gateway.calls).toHaveLength(0);
    });

    it('answers 400 RESERVATIONS_MISMATCH for reservations of two events', async () => {
      const first = await group(1);
      const secondEvent = await insertEventWithSeats(ctx.db, {
        capacity: 30,
        max_seats_per_user: 8,
      });
      const other = await request(ctx.app)
        .post('/reservations')
        .set(...bearer(first.token))
        .send({ eventId: secondEvent.id, seats: ['B1'] });
      const res = await pay(first.token, [
        first.reservations[0]!.id,
        other.body.reservations[0].id,
      ]);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RESERVATIONS_MISMATCH');
      expect(gateway.calls).toHaveLength(0);
    });

    it('answers DUPLICATE_PAYMENT when one reservation was already paid, even next to a vigent one', async () => {
      const { token, reservations } = await group(2);
      await pay(token, [reservations[0]!.id]);
      const res = await pay(
        token,
        reservations.map((r) => r.id),
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_PAYMENT');
      expect(gateway.calls).toHaveLength(1);
      expect((await statusesOf([reservations[1]!.id]))[0]!.status).toBe('ACTIVE');
    });

    it('answers 404 for an unknown reservation', async () => {
      const { token, reservations } = await group(1);
      const res = await pay(token, [reservations[0]!.id, crypto.randomUUID()]);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('RESERVATION_NOT_FOUND');
    });
  });

  describe('maximum order amount', () => {
    it('accepts one reservation at the maximum price', async () => {
      const { token, reservations } = await group(1, { price: 9_999_999_999.99 });
      const res = await pay(token, [reservations[0]!.id]);
      expect(res.status).toBe(201);
      expect(res.body.amount).toBe(9_999_999_999.99);
    });

    it('accepts three reservations that add up exactly to the maximum', async () => {
      const { token, reservations } = await group(3, { price: 3_333_333_333.33 });
      const res = await pay(
        token,
        reservations.map((r) => r.id),
      );
      expect(res.status).toBe(201);
      expect(res.body.amount).toBe(9_999_999_999.99);
    });

    it('rejects two reservations of 5.000.000.000,00 before claiming or charging', async () => {
      const { token, reservations } = await group(2, { price: 5_000_000_000 });
      const ids = reservations.map((r) => r.id);
      const res = await pay(token, ids);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ORDER_AMOUNT_TOO_LARGE');
      expect(gateway.calls).toHaveLength(0);
      expect(
        (await statusesOf(ids)).every(
          (r) => r.payment_started_at === null && r.status === 'ACTIVE',
        ),
      ).toBe(true);
    });
  });

  describe('payments that are not approved', () => {
    it.each([
      [402, gatewayExamples.rejected, 'PAYMENT_REJECTED'],
      [422, gatewayExamples.cardFlagged, 'CARD_PROBLEM'],
      [502, gatewayExamples.gatewayError, 'PAYMENT_GATEWAY_ERROR'],
    ])(
      'on %i creates nothing, keeps every reservation ACTIVE and lets the user try again at once',
      async (status, body, code) => {
        const { token, reservations } = await group(3);
        const ids = reservations.map((r) => r.id);
        gateway.respond(status, body);

        const res = await pay(token, ids);

        expect(res.status).toBe(status);
        expect(res.body.code).toBe(code);
        expect(await count('orders')).toBe(0);
        expect(await count('payments')).toBe(0);
        expect(await count('tickets')).toBe(0);
        const rows = await statusesOf(ids);
        expect(rows.every((r) => r.status === 'ACTIVE' && r.payment_started_at === null)).toBe(
          true,
        );
        expect(await seatStatuses(reservations.map((r) => r.seatId))).toEqual([
          'RESERVED',
          'RESERVED',
          'RESERVED',
        ]);

        gateway.reset();
        expect((await pay(token, ids)).status).toBe(201);
      },
    );
  });

  describe('payment in progress', () => {
    it('answers 409 PAYMENT_IN_PROGRESS without calling the gateway when a reservation is already claimed', async () => {
      const { token, reservations } = await group(2);
      await ctx.db
        .updateTable('reservations')
        .set({ payment_started_at: new Date() })
        .where('id', '=', reservations[1]!.id)
        .execute();

      const res = await pay(
        token,
        reservations.map((r) => r.id),
      );

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PAYMENT_IN_PROGRESS');
      expect(gateway.calls).toHaveLength(0);
    });

    it('claims nothing when the sets overlap: the free reservation stays free', async () => {
      const { token, reservations } = await group(3);
      const [a, b, c] = reservations.map((r) => r.id) as [string, string, string];
      await ctx.db
        .updateTable('reservations')
        .set({ payment_started_at: new Date() })
        .where('id', '=', b)
        .execute();

      const res = await pay(token, [a, b]);

      expect(res.body.code).toBe('PAYMENT_IN_PROGRESS');
      const rows = Object.fromEntries(
        (await statusesOf([a, b, c])).map((r) => [r.id, r.payment_started_at]),
      );
      expect(rows[a]).toBeNull();
      expect(rows[c]).toBeNull();
    });

    it.each([
      [29, 409],
      [31, 201],
    ])('a claim made %i seconds ago answers %i', async (seconds, expected) => {
      const { token, reservations } = await group(1);
      await ctx.db
        .updateTable('reservations')
        .set({ payment_started_at: new Date(Date.now() - seconds * 1000) })
        .execute();
      const res = await pay(token, [reservations[0]!.id]);
      expect(res.status).toBe(expected);
    });

    it('keeps the claim after a gateway timeout and answers PAYMENT_IN_PROGRESS to an immediate new attempt', async () => {
      const slow = await createTestContext({ PAYMENT_GATEWAY_TIMEOUT_MS: '100' });
      try {
        await slow.reset();
        const { token } = await createUserAndLogin(slow.app, slow.db, 'USER', 'slow@mail.com');
        const event = await insertEventWithSeats(slow.db, { capacity: 30, max_seats_per_user: 8 });
        const made = await request(slow.app)
          .post('/reservations')
          .set(...bearer(token))
          .send({ eventId: event.id, seats: ['A1', 'A2'] });
        const ids = made.body.reservations.map((r: Reserved) => r.id);
        const send = () =>
          request(slow.app)
            .post('/tickets/purchase')
            .set(...bearer(token))
            .send(purchaseBody(ids));
        gateway.delayedBy(600);

        const first = await send();
        expect(first.status).toBe(504);
        expect(first.body.code).toBe('PAYMENT_GATEWAY_TIMEOUT');
        const again = await send();
        expect(again.status).toBe(409);
        expect(again.body.code).toBe('PAYMENT_IN_PROGRESS');
      } finally {
        await slow.close();
      }
    });
  });

  describe('purchases in flight', () => {
    it('records ONE REFUND_PENDING payment for the whole total when the event is cancelled while paying', async () => {
      const { token, eventId, reservations } = await group(3, { price: 100 });
      gateway.respondWith(async () => {
        await ctx.db
          .updateTable('events')
          .set({ status: 'CANCELLED' })
          .where('id', '=', eventId)
          .execute();
        return HttpResponse.json(gatewayExamples.approved);
      });

      const res = await pay(
        token,
        reservations.map((r) => r.id),
      );

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EVENT_CANCELLED');
      expect(await count('tickets')).toBe(0);
      const payments = await ctx.db.selectFrom('payments').selectAll().execute();
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        status: 'REFUND_PENDING',
        transaction_id: gatewayExamples.approved.transactionId,
      });
      expect(Number(payments[0]!.amount)).toBe(300);
      expect(await count('orders')).toBe(1);
    });

    it('answers RESERVATION_ALREADY_CANCELLED and keeps the others ACTIVE when the owner cancels one while paying', async () => {
      const { token, reservations } = await group(3);
      const [a, b, c] = reservations as [Reserved, Reserved, Reserved];
      gateway.respondWith(async () => {
        const cancelled = await request(ctx.app)
          .post(`/reservations/${b.id}/cancel`)
          .set(...bearer(token));
        expect(cancelled.status).toBe(200);
        return HttpResponse.json(gatewayExamples.approved);
      });

      const res = await pay(token, [a.id, b.id, c.id]);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RESERVATION_ALREADY_CANCELLED');
      expect(await count('tickets')).toBe(0);
      const payment = await ctx.db.selectFrom('payments').selectAll().executeTakeFirstOrThrow();
      expect(payment.status).toBe('REFUND_PENDING');
      const rows = Object.fromEntries((await statusesOf([a.id, b.id, c.id])).map((r) => [r.id, r]));
      expect(rows[b.id]!.status).toBe('CANCELLED_BY_USER');
      expect(rows[a.id]!.status).toBe('ACTIVE');
      expect(rows[c.id]!.status).toBe('ACTIVE');
      expect(rows[a.id]!.payment_started_at).toBeNull();
      expect((await seatStatuses([b.seatId]))[0]).toBe('AVAILABLE');
    });

    it('answers RESERVATION_EXPIRED when one reservation expires while paying', async () => {
      const { token, reservations } = await group(2);
      gateway.respondWith(async () => {
        await ctx.db
          .updateTable('reservations')
          .set({ status: 'EXPIRED' })
          .where('id', '=', reservations[1]!.id)
          .execute();
        return HttpResponse.json(gatewayExamples.approved);
      });
      const res = await pay(
        token,
        reservations.map((r) => r.id),
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RESERVATION_EXPIRED');
      expect(await count('tickets')).toBe(0);
      expect(await count('payments')).toBe(1);
    });
  });

  describe('cancelling an event with ordered tickets', () => {
    it('counts every ticket, marks each shared payment REFUND_PENDING once and leaves other events alone', async () => {
      // Cada compra necesita su propio transactionId (es único en payments)
      gateway.respondWith(() =>
        HttpResponse.json({ status: 'APPROVED', transactionId: crypto.randomUUID() }),
      );
      const admin = (await createUserAndLogin(ctx.app, ctx.db, 'ADMIN')).token;
      const triple = await group(3);
      const single = await group(1, { eventId: triple.eventId, from: 4 });
      const otherEvent = await group(2);
      for (const g of [triple, single, otherEvent]) {
        const bought = await pay(
          g.token,
          g.reservations.map((r) => r.id),
        );
        expect([bought.status, bought.body.code]).toEqual([201, undefined]);
      }

      const res = await request(ctx.app)
        .post(`/events/${triple.eventId}/cancel`)
        .set(...bearer(admin));

      expect(res.status).toBe(200);
      expect(res.body.cancelledTickets).toBe(4);
      const payments = await ctx.db
        .selectFrom('payments')
        .innerJoin('orders', 'orders.id', 'payments.order_id')
        .select(['payments.status as status', 'orders.event_id as event_id'])
        .execute();
      expect(payments.filter((p) => p.event_id === triple.eventId).map((p) => p.status)).toEqual([
        'REFUND_PENDING',
        'REFUND_PENDING',
      ]);
      expect(
        payments.filter((p) => p.event_id === otherEvent.eventId).map((p) => p.status),
      ).toEqual(['APPROVED']);
      const mine = await request(ctx.app)
        .get('/tickets/me')
        .set(...bearer(triple.token));
      expect(
        mine.body.data.every((t: { status: string }) => t.status === 'CANCELLED_BY_EVENT'),
      ).toBe(true);
    });
  });
});
