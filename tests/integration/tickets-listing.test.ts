import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats, seatOf } from '../helpers/events.js';
import { insertTicket } from '../helpers/purchase.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('GET /tickets/me', () => {
  let ctx: TestContext;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    token = (await createUserAndLogin(ctx.app, ctx.db, 'USER')).token;
    userId = (
      await ctx.db
        .selectFrom('users')
        .select('id')
        .where('role', '=', 'USER')
        .executeTakeFirstOrThrow()
    ).id;
  });

  const mine = (query: object = {}, auth: string | null = token) => {
    const req = request(ctx.app).get('/tickets/me').query(query);
    if (auth) req.set(...bearer(auth));
    return req;
  };
  const seat = async (eventId: string, n: number) => (await seatOf(ctx.db, eventId, 'A', n)).id;

  it('returns only my tickets, newest first, with event data and meta', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10, name: 'Rock Night' });
    const other = (await createUserAndLogin(ctx.app, ctx.db, 'USER', 'other@mail.com')).token;
    void other;
    const otherId = (
      await ctx.db
        .selectFrom('users')
        .select('id')
        .where('email', '=', 'other@mail.com')
        .executeTakeFirstOrThrow()
    ).id;
    await insertTicket(ctx.db, {
      userId,
      eventId: event.id,
      seatId: await seat(event.id, 1),
      issuedAt: new Date('2026-01-01T10:00:00Z'),
    });
    await insertTicket(ctx.db, {
      userId,
      eventId: event.id,
      seatId: await seat(event.id, 2),
      issuedAt: new Date('2026-02-01T10:00:00Z'),
    });
    await insertTicket(ctx.db, {
      userId: otherId,
      eventId: event.id,
      seatId: await seat(event.id, 3),
    });

    const res = await mine();
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    expect(res.body.data.map((t: { seat: string }) => t.seat)).toEqual(['A2', 'A1']);
    expect(res.body.data[0]).toEqual({
      id: expect.any(String),
      status: 'ISSUED',
      seat: 'A2',
      amount: 100,
      issuedAt: '2026-02-01T10:00:00.000Z',
      event: { id: event.id, name: 'Rock Night', venue: 'Venue', startDate: expect.any(String) },
    });
  });

  it('returns an empty list when the user has no tickets', async () => {
    const res = await mine();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
  });

  it('paginates 25 tickets: page 2 has 5', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 30 });
    const seats = await ctx.db
      .selectFrom('seats')
      .select('id')
      .where('event_id', '=', event.id)
      .limit(25)
      .execute();
    let i = 0;
    for (const s of seats) {
      await insertTicket(ctx.db, {
        userId,
        eventId: event.id,
        seatId: s.id,
        issuedAt: new Date(Date.now() - ++i * 1000),
      });
    }
    const page1 = await mine({ page: 1, pageSize: 20 });
    const page2 = await mine({ page: 2, pageSize: 20 });
    expect(page1.body.data).toHaveLength(20);
    expect(page2.body.data).toHaveLength(5);
    expect(page2.body.meta).toEqual({ page: 2, pageSize: 20, total: 25, totalPages: 2 });
    const ids = [...page1.body.data, ...page2.body.data].map((t: { id: string }) => t.id);
    expect(new Set(ids).size).toBe(25);
  });

  it('shows tickets of cancelled events as CANCELLED_BY_EVENT', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    await insertTicket(ctx.db, {
      userId,
      eventId: event.id,
      seatId: await seat(event.id, 1),
      status: 'CANCELLED_BY_EVENT',
    });
    expect((await mine()).body.data[0].status).toBe('CANCELLED_BY_EVENT');
  });

  it.each([
    ['pageSize 21', { pageSize: 21 }],
    ['pageSize 0', { pageSize: 0 }],
    ['page 0', { page: 0 }],
  ])('returns 400 VALIDATION_ERROR for %s', async (_name, query) => {
    const res = await mine(query);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without a token and 403 for an ADMIN', async () => {
    expect((await mine({}, null)).status).toBe(401);
    const admin = (await createUserAndLogin(ctx.app, ctx.db, 'ADMIN')).token;
    const res = await mine({}, admin);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
