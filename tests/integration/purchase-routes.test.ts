import request from 'supertest';
import { HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/shared/logger.js';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { expireReservations, insertEventWithSeats, seatOf } from '../helpers/events.js';
import { createGatewayMock, GATEWAY_API_KEY, gatewayExamples } from '../helpers/gateway-mock.js';
import { createLogCapture } from '../helpers/log-capture.js';
import { CARD, purchaseBody, reserveSeat } from '../helpers/purchase.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('POST /tickets/purchase', () => {
  const gateway = createGatewayMock();
  const capture = createLogCapture();
  let ctx: TestContext;

  beforeAll(async () => {
    gateway.start();
    ctx = await createTestContext({}, {}, createLogger('trace', capture.stream));
  });
  afterAll(async () => {
    gateway.stop();
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });
  afterEach(() => {
    gateway.reset();
    capture.lines.length = 0;
  });

  const purchase = (token: string | null, body: object) => {
    const req = request(ctx.app).post('/tickets/purchase');
    if (token) req.set(...bearer(token));
    return req.send(body);
  };
  const count = async (table: 'tickets' | 'payments') =>
    (await ctx.db.selectFrom(table).selectAll().execute()).length;
  const reservationStatus = async (id: string) =>
    (
      await ctx.db
        .selectFrom('reservations')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;
  const seatStatus = async (id: string) =>
    (
      await ctx.db
        .selectFrom('seats')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;

  describe('successful purchase', () => {
    it('issues the ticket, marks the seat SOLD and the reservation CONFIRMED', async () => {
      const { token, eventId, reservation } = await reserveSeat(ctx.app, ctx.db, { seat: 'B3' });
      const res = await purchase(token, purchaseBody(reservation.id));

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        reservationId: reservation.id,
        eventId,
        seat: 'B3',
        status: 'ISSUED',
        amount: 150000,
        transactionId: gatewayExamples.approved.transactionId,
        issuedAt: expect.any(String),
      });
      expect(await seatStatus(reservation.seatId)).toBe('SOLD');
      expect(await reservationStatus(reservation.id)).toBe('CONFIRMED');
      const payment = await ctx.db.selectFrom('payments').selectAll().executeTakeFirstOrThrow();
      expect(payment).toMatchObject({
        status: 'APPROVED',
        transaction_id: gatewayExamples.approved.transactionId,
      });
      expect(Number(payment.amount)).toBe(150000);
    });

    it('calls the gateway once with the reservation amount, the Bearer key and an uppercase brand', async () => {
      const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
      await purchase(token, purchaseBody(reservation.id, { ...CARD, brand: 'visa' }));
      expect(gateway.calls).toHaveLength(1);
      expect(gateway.calls[0]).toEqual({
        authorization: `Bearer ${GATEWAY_API_KEY}`,
        body: { reservationId: reservation.id, amount: 150000, card: CARD },
      });
    });

    it('rejects a client-sent amount without calling the gateway', async () => {
      const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
      const res = await purchase(token, { ...purchaseBody(reservation.id), amount: 1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(gateway.calls).toHaveLength(0);
    });
  });

  describe('card brand', () => {
    const cases: [string, Record<string, unknown>, string, string][] = [
      [
        'missing',
        { number: CARD.number, expiry: CARD.expiry, cvv: CARD.cvv },
        'CARD_BRAND_REQUIRED',
        'Card brand is required. Use VISA, MASTERCARD or AMEX',
      ],
      [
        'null',
        { ...CARD, brand: null },
        'CARD_BRAND_REQUIRED',
        'Card brand is required. Use VISA, MASTERCARD or AMEX',
      ],
      [
        'empty',
        { ...CARD, brand: '' },
        'CARD_BRAND_REQUIRED',
        'Card brand is required. Use VISA, MASTERCARD or AMEX',
      ],
      [
        'not allowed',
        { ...CARD, brand: 'DINERS' },
        'CARD_BRAND_NOT_ALLOWED',
        'Card brand not allowed. Use VISA, MASTERCARD or AMEX',
      ],
    ];

    it.each(cases)(
      'answers 400 with a specific message when the brand is %s, with no gateway call',
      async (_name, card, code, message) => {
        const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
        const res = await purchase(token, { reservationId: reservation.id, card });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ code, message });
        expect(gateway.calls).toHaveLength(0);
        expect(await reservationStatus(reservation.id)).toBe('ACTIVE');
      },
    );

    it('translates a BRAND_NOT_ALLOWED answer from the gateway', async () => {
      gateway.respond(400, gatewayExamples.brandNotAllowed);
      const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
      const res = await purchase(token, purchaseBody(reservation.id));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CARD_BRAND_NOT_ALLOWED');
    });
  });

  describe('access and validation', () => {
    it('returns 403 for a reservation of another user, without calling the gateway', async () => {
      const { reservation } = await reserveSeat(ctx.app, ctx.db);
      const other = (await createUserAndLogin(ctx.app, ctx.db, 'USER', 'other@mail.com')).token;
      const res = await purchase(other, purchaseBody(reservation.id));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(gateway.calls).toHaveLength(0);
      expect(await reservationStatus(reservation.id)).toBe('ACTIVE');
    });

    it('returns 403 for an ADMIN and 401 without a token', async () => {
      const { reservation } = await reserveSeat(ctx.app, ctx.db);
      const admin = (await createUserAndLogin(ctx.app, ctx.db, 'ADMIN')).token;
      expect((await purchase(admin, purchaseBody(reservation.id))).status).toBe(403);
      const noToken = await purchase(null, purchaseBody(reservation.id));
      expect(noToken.status).toBe(401);
      expect(noToken.body.code).toBe('UNAUTHORIZED');
    });

    it.each([
      ['an invalid reservationId', (r: string) => ({ reservationId: 'abc', card: CARD, _r: r })],
      ['a missing cvv', (r: string) => ({ reservationId: r, card: { ...CARD, cvv: undefined } })],
      ['a missing card', (r: string) => ({ reservationId: r })],
    ])('returns 400 VALIDATION_ERROR for %s', async (_name, build) => {
      const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
      const { _r, ...body } = build(reservation.id) as Record<string, unknown>;
      void _r;
      const res = await purchase(token, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(gateway.calls).toHaveLength(0);
    });

    it('returns 404 RESERVATION_NOT_FOUND for an unknown reservation', async () => {
      const { token } = await reserveSeat(ctx.app, ctx.db);
      const res = await purchase(token, purchaseBody(crypto.randomUUID()));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('RESERVATION_NOT_FOUND');
      expect(gateway.calls).toHaveLength(0);
    });
  });

  describe('reservation and event state', () => {
    it('returns 409 RESERVATION_EXPIRED for a reservation expired by time, even if the job has not released it', async () => {
      const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
      await expireReservations(ctx.db, reservation.seatId);
      const res = await purchase(token, purchaseBody(reservation.id));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RESERVATION_EXPIRED');
      expect(gateway.calls).toHaveLength(0);
    });

    it.each(['EXPIRED', 'CANCELLED'])(
      'returns 409 RESERVATION_EXPIRED for a %s reservation',
      async (status) => {
        const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
        await ctx.db
          .updateTable('reservations')
          .set({ status })
          .where('id', '=', reservation.id)
          .execute();
        const res = await purchase(token, purchaseBody(reservation.id));
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('RESERVATION_EXPIRED');
        expect(gateway.calls).toHaveLength(0);
      },
    );

    it('returns 409 EVENT_CANCELLED for a cancelled event, even if its reservation was cancelled too', async () => {
      const { token, eventId, reservation } = await reserveSeat(ctx.app, ctx.db);
      const admin = (await createUserAndLogin(ctx.app, ctx.db, 'ADMIN')).token;
      await request(ctx.app)
        .post(`/events/${eventId}/cancel`)
        .set(...bearer(admin));
      const res = await purchase(token, purchaseBody(reservation.id));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EVENT_CANCELLED');
      expect(gateway.calls).toHaveLength(0);
    });
  });

  describe('gateway answers that do not approve', () => {
    const cases: [string, () => void, number, string][] = [
      ['402', () => gateway.respond(402, gatewayExamples.rejected), 402, 'PAYMENT_REJECTED'],
      ['422', () => gateway.respond(422, gatewayExamples.cardFlagged), 422, 'CARD_PROBLEM'],
      [
        '502',
        () => gateway.respond(502, gatewayExamples.gatewayError),
        502,
        'PAYMENT_GATEWAY_ERROR',
      ],
      [
        '400 INVALID_REQUEST',
        () => gateway.respond(400, gatewayExamples.invalidRequest),
        400,
        'VALIDATION_ERROR',
      ],
      ['401', () => gateway.respond(401, gatewayExamples.unauthorized), 500, 'INTERNAL_ERROR'],
      ['a non-JSON 500', () => gateway.respondText(500, 'oops'), 502, 'PAYMENT_GATEWAY_ERROR'],
      ['a connection failure', () => gateway.networkError(), 502, 'PAYMENT_GATEWAY_ERROR'],
    ];

    it.each(cases)(
      'maps %s to HTTP %i %s and leaves everything as it was',
      async (_name, arrange, status, code) => {
        arrange();
        const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
        const res = await purchase(token, purchaseBody(reservation.id));

        expect(res.status).toBe(status);
        expect(res.body.code).toBe(code);
        expect(gateway.calls).toHaveLength(1); // sin reintentos automáticos
        expect(await reservationStatus(reservation.id)).toBe('ACTIVE');
        expect(await seatStatus(reservation.seatId)).toBe('RESERVED');
        expect(await count('tickets')).toBe(0);
        expect(await count('payments')).toBe(0);
      },
    );

    it('does not expose the API key when the gateway rejects it, and logs the incident', async () => {
      gateway.respond(401, gatewayExamples.unauthorized);
      const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
      const res = await purchase(token, purchaseBody(reservation.id));
      expect(JSON.stringify(res.body)).not.toContain(GATEWAY_API_KEY);
      expect(res.body.message).toBe('Internal server error');
      expect(capture.text()).toContain('PAYMENT_GATEWAY_API_KEY');
      expect(capture.text()).not.toContain(GATEWAY_API_KEY);
    });

    it('lets the user retry after a gateway error and succeed', async () => {
      const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
      gateway.respond(502, gatewayExamples.gatewayError);
      expect((await purchase(token, purchaseBody(reservation.id))).status).toBe(502);
      gateway.respond(200, gatewayExamples.approved);
      expect((await purchase(token, purchaseBody(reservation.id))).status).toBe(201);
      expect(gateway.calls).toHaveLength(2);
    });
  });

  describe('idempotency and concurrency', () => {
    it('returns 200 with the same ticket and no new gateway call when repeated', async () => {
      const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
      const first = await purchase(token, purchaseBody(reservation.id));
      const again = await purchase(token, purchaseBody(reservation.id));
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      expect(gateway.calls).toHaveLength(1);
      expect(await count('tickets')).toBe(1);
      expect(await count('payments')).toBe(1);
    });

    it('leaves a single ticket and payment when many requests pay the same reservation at once', async () => {
      const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => purchase(token, purchaseBody(reservation.id))),
      );

      expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await count('tickets')).toBe(1);
      expect(await count('payments')).toBe(1);
      expect(await seatStatus(reservation.seatId)).toBe('SOLD');
    });
  });

  describe('purchases in flight', () => {
    it('answers EVENT_CANCELLED and records REFUND_PENDING when the event is cancelled while paying', async () => {
      const { token, eventId, reservation } = await reserveSeat(ctx.app, ctx.db);
      gateway.respondWith(async () => {
        await ctx.db
          .updateTable('events')
          .set({ status: 'CANCELLED' })
          .where('id', '=', eventId)
          .execute();
        return HttpResponse.json(gatewayExamples.approved);
      });
      const res = await purchase(token, purchaseBody(reservation.id));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EVENT_CANCELLED');
      expect(await count('tickets')).toBe(0);
      const payment = await ctx.db.selectFrom('payments').selectAll().executeTakeFirstOrThrow();
      expect(payment).toMatchObject({
        status: 'REFUND_PENDING',
        transaction_id: gatewayExamples.approved.transactionId,
      });
      expect(await seatStatus(reservation.seatId)).toBe('RESERVED');
    });

    it('answers RESERVATION_EXPIRED and records REFUND_PENDING when the reservation is released while paying', async () => {
      const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
      gateway.respondWith(async () => {
        await expireReservations(ctx.db, reservation.seatId);
        await ctx.container.reservationService.releaseExpired();
        return HttpResponse.json(gatewayExamples.approved);
      });
      const res = await purchase(token, purchaseBody(reservation.id));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RESERVATION_EXPIRED');
      expect(await count('tickets')).toBe(0);
      const payment = await ctx.db.selectFrom('payments').selectAll().executeTakeFirstOrThrow();
      expect(payment.status).toBe('REFUND_PENDING');
      expect(await reservationStatus(reservation.id)).toBe('EXPIRED');
      expect(await seatStatus(reservation.seatId)).toBe('AVAILABLE');
    });
  });

  describe('card data', () => {
    it('is never stored nor logged, after successful and failed purchases', async () => {
      const ok = await reserveSeat(ctx.app, ctx.db, { email: 'ok@mail.com', seat: 'A1' });
      await purchase(ok.token, purchaseBody(ok.reservation.id));
      const failing = await reserveSeat(ctx.app, ctx.db, {
        email: 'fail@mail.com',
        seat: 'A2',
        eventId: ok.eventId,
      });
      for (const arrange of [
        () => gateway.respond(502, gatewayExamples.gatewayError),
        () => gateway.networkError(),
        () => gateway.respond(401, gatewayExamples.unauthorized),
        () => gateway.respond(402, gatewayExamples.rejected),
      ]) {
        arrange();
        await purchase(failing.token, purchaseBody(failing.reservation.id));
      }

      const dump = JSON.stringify({
        tickets: await ctx.db.selectFrom('tickets').selectAll().execute(),
        payments: await ctx.db.selectFrom('payments').selectAll().execute(),
        reservations: await ctx.db.selectFrom('reservations').selectAll().execute(),
        users: await ctx.db.selectFrom('users').selectAll().execute(),
      });
      for (const secret of [CARD.number, CARD.expiry]) {
        expect(dump).not.toContain(secret);
        expect(capture.text()).not.toContain(secret);
      }
      expect(capture.text()).not.toMatch(/"cvv":"123"/);
      expect(capture.text()).not.toContain(GATEWAY_API_KEY);
    });
  });
});

describe('POST /tickets/purchase with a short gateway timeout', () => {
  const gateway = createGatewayMock();
  let ctx: TestContext;

  beforeAll(async () => {
    gateway.start();
    ctx = await createTestContext({ PAYMENT_GATEWAY_TIMEOUT_MS: '150' });
  });
  afterAll(async () => {
    gateway.stop();
    await ctx.close();
  });

  it('answers 504 PAYMENT_GATEWAY_TIMEOUT and keeps the reservation ACTIVE', async () => {
    await ctx.reset();
    gateway.delayedBy(600);
    const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
    const res = await request(ctx.app)
      .post('/tickets/purchase')
      .set(...bearer(token))
      .send(purchaseBody(reservation.id));

    expect(res.status).toBe(504);
    expect(res.body.code).toBe('PAYMENT_GATEWAY_TIMEOUT');
    expect(gateway.calls).toHaveLength(1);
    const row = await ctx.db
      .selectFrom('reservations')
      .select('status')
      .where('id', '=', reservation.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('ACTIVE');
    expect(await ctx.db.selectFrom('tickets').selectAll().execute()).toHaveLength(0);
    expect(
      (
        await seatOf(
          ctx.db,
          (await ctx.db.selectFrom('events').select('id').executeTakeFirstOrThrow()).id,
          'A',
          1,
        )
      ).status,
    ).toBe('RESERVED');
    void insertEventWithSeats;
  });
});
