import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { expireReservations, futureDate, insertEventWithSeats, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('POST /reservations', () => {
  let ctx: TestContext;
  let userToken: string;
  let adminToken: string;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    userToken = (await createUserAndLogin(ctx.app, ctx.db, 'USER')).token;
    adminToken = (await createUserAndLogin(ctx.app, ctx.db, 'ADMIN')).token;
    eventId = (await insertEventWithSeats(ctx.db, { capacity: 20, price: 150000 })).id;
  });

  const reserve = (token: string | null, body: object) => {
    const req = request(ctx.app).post('/reservations');
    if (token) req.set(...bearer(token));
    return req.send(body);
  };
  const seatStatus = async (row: string, number: number) =>
    (await seatOf(ctx.db, eventId, row, number)).status;

  it('creates an ACTIVE reservation with the event price and marks the seat RESERVED', async () => {
    const res = await reserve(userToken, { eventId, seat: 'B3' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      eventId,
      seatId: (await seatOf(ctx.db, eventId, 'B', 3)).id,
      seat: 'B3',
      status: 'ACTIVE',
      amount: 150000,
      expiresAt: expect.any(String),
      createdAt: expect.any(String),
    });
    expect(await seatStatus('B', 3)).toBe('RESERVED');
    const diff = new Date(res.body.expiresAt).getTime() - new Date(res.body.createdAt).getTime();
    expect(diff / 60_000).toBeCloseTo(10, 1);
  });

  it('accepts a lowercase label', async () => {
    const res = await reserve(userToken, { eventId, seat: 'a1' });
    expect(res.status).toBe(201);
    expect(res.body.seat).toBe('A1');
  });

  it('records the authenticated user as owner', async () => {
    await reserve(userToken, { eventId, seat: 'A1' });
    const row = await ctx.db.selectFrom('reservations').selectAll().executeTakeFirstOrThrow();
    const user = await ctx.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'USER')
      .executeTakeFirstOrThrow();
    expect(row.user_id).toBe(user.id);
  });

  it('returns 403 FORBIDDEN for an ADMIN and does not reserve', async () => {
    const res = await reserve(adminToken, { eventId, seat: 'A1' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await seatStatus('A', 1)).toBe('AVAILABLE');
  });

  it('returns 401 UNAUTHORIZED without a token', async () => {
    const res = await reserve(null, { eventId, seat: 'A1' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it.each([
    ['a missing eventId', { eventId: undefined, seat: 'A1' }],
    ['a missing seat', {}],
    ['an invalid eventId', { eventId: 'abc', seat: 'A1' }],
    ['a label like 7C', { seat: '7C' }],
    ['a label like C11', { seat: 'C11' }],
    ['a client-sent amount', { seat: 'A1', amount: 1 }],
  ])('returns 400 VALIDATION_ERROR for %s', async (_name, override) => {
    const res = await reserve(userToken, { eventId, ...override });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await ctx.db.selectFrom('reservations').selectAll().execute()).toHaveLength(0);
  });

  it('returns 404 EVENT_NOT_FOUND for an unknown event', async () => {
    const res = await reserve(userToken, { eventId: crypto.randomUUID(), seat: 'A1' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('EVENT_NOT_FOUND');
  });

  it('returns 404 SEAT_NOT_FOUND for a label outside the capacity (C7 in a 20-seat event)', async () => {
    const res = await reserve(userToken, { eventId, seat: 'C7' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SEAT_NOT_FOUND');
  });

  it('does not reserve a seat of another event', async () => {
    const small = (await insertEventWithSeats(ctx.db, { capacity: 10 })).id;
    const res = await reserve(userToken, { eventId: small, seat: 'B3' }); // B3 solo existe en el evento grande
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SEAT_NOT_FOUND');
    expect(await seatStatus('B', 3)).toBe('AVAILABLE');
  });

  it('returns 409 SEAT_NOT_AVAILABLE for a seat already reserved by another user, keeping the first reservation', async () => {
    const second = (await createUserAndLogin(ctx.app, ctx.db, 'USER', 'other@mail.com')).token;
    const first = await reserve(userToken, { eventId, seat: 'A1' });
    const res = await reserve(second, { eventId, seat: 'A1' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEAT_NOT_AVAILABLE');
    const rows = await ctx.db.selectFrom('reservations').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.body.id);
  });

  it.each(['SOLD', 'BLOCKED'])('returns 409 SEAT_NOT_AVAILABLE for a %s seat', async (status) => {
    await ctx.db
      .updateTable('seats')
      .set({ status })
      .where('id', '=', (await seatOf(ctx.db, eventId, 'A', 1)).id)
      .execute();
    const res = await reserve(userToken, { eventId, seat: 'A1' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEAT_NOT_AVAILABLE');
  });

  it('returns 409 EVENT_NOT_ACTIVE for a cancelled event, even if its seats are BLOCKED', async () => {
    const cancelled = await insertEventWithSeats(ctx.db, { capacity: 10, status: 'CANCELLED' });
    await ctx.db
      .updateTable('seats')
      .set({ status: 'BLOCKED' })
      .where('event_id', '=', cancelled.id)
      .execute();
    const res = await reserve(userToken, { eventId: cancelled.id, seat: 'A1' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EVENT_NOT_ACTIVE');
  });

  it('returns 409 EVENT_NOT_ACTIVE for an event that already started', async () => {
    const started = await insertEventWithSeats(ctx.db, {
      capacity: 10,
      start_date: new Date(Date.now() - 3600_000).toISOString(),
      end_date: futureDate(1),
    });
    const res = await reserve(userToken, { eventId: started.id, seat: 'A1' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EVENT_NOT_ACTIVE');
  });

  it('lets exactly one of many simultaneous requests reserve the same seat', async () => {
    const tokens = [userToken];
    for (let i = 0; i < 5; i++) {
      tokens.push((await createUserAndLogin(ctx.app, ctx.db, 'USER', `u${i}@mail.com`)).token);
    }
    const results = await Promise.all(tokens.map((t) => reserve(t, { eventId, seat: 'A1' })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    const active = await ctx.db
      .selectFrom('reservations')
      .selectAll()
      .where('status', '=', 'ACTIVE')
      .execute();
    expect(active).toHaveLength(1);
    expect(await seatStatus('A', 1)).toBe('RESERVED');
  });

  it('lets another user reserve a seat whose reservation already expired, right away', async () => {
    const second = (await createUserAndLogin(ctx.app, ctx.db, 'USER', 'other@mail.com')).token;
    const first = await reserve(userToken, { eventId, seat: 'A1' });
    await expireReservations(ctx.db, first.body.seatId);

    const res = await reserve(second, { eventId, seat: 'A1' });
    expect(res.status).toBe(201);
    const old = await ctx.db
      .selectFrom('reservations')
      .select('status')
      .where('id', '=', first.body.id)
      .executeTakeFirstOrThrow();
    expect(old.status).toBe('EXPIRED');
    expect(await seatStatus('A', 1)).toBe('RESERVED');
  });
});

describe('POST /reservations with a custom TTL', () => {
  it('uses RESERVATION_TTL_MINUTES', async () => {
    const ctx = await createTestContext({ RESERVATION_TTL_MINUTES: '3' });
    await ctx.reset();
    const token = (await createUserAndLogin(ctx.app, ctx.db, 'USER')).token;
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const res = await request(ctx.app)
      .post('/reservations')
      .set(...bearer(token))
      .send({ eventId: event.id, seat: 'A1' });
    const diff = new Date(res.body.expiresAt).getTime() - new Date(res.body.createdAt).getTime();
    expect(diff / 60_000).toBeCloseTo(3, 1);
    await ctx.close();
  });
});
