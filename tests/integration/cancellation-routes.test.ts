import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import {
  futureDate,
  insertEvent,
  insertEventWithSeats,
  insertReservation,
  seatOf,
} from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('POST /events/:id/cancel', () => {
  let ctx: TestContext;
  let adminToken: string;
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    adminToken = (await createUserAndLogin(ctx.app, ctx.db, 'ADMIN')).token;
    userToken = (await createUserAndLogin(ctx.app, ctx.db, 'USER')).token;
    userId = (
      await ctx.db
        .selectFrom('users')
        .select('id')
        .where('role', '=', 'USER')
        .executeTakeFirstOrThrow()
    ).id;
  });

  const cancel = (id: string, token: string | null = adminToken) => {
    const req = request(ctx.app).post(`/events/${id}/cancel`);
    if (token) req.set(...bearer(token));
    return req;
  };
  const statusOf = async (id: string) =>
    (
      await ctx.db
        .selectFrom('events')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;

  it('cancels an ACTIVE event without deleting it', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const res = await cancel(event.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: event.id,
      status: 'CANCELLED',
      cancelledReservations: 0,
      cancelledTickets: 0,
    });
    expect(await statusOf(event.id)).toBe('CANCELLED');
    const list = await request(ctx.app).get('/events');
    expect(list.body.data).toEqual([
      expect.objectContaining({ id: event.id, status: 'CANCELLED' }),
    ]);
  });

  it('returns 403 FORBIDDEN for a USER and 401 without a token, changing nothing', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const forbidden = await cancel(event.id, userToken);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');
    const unauthorized = await cancel(event.id, null);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.code).toBe('UNAUTHORIZED');
    expect(await statusOf(event.id)).toBe('ACTIVE');
  });

  it('returns 404 EVENT_NOT_FOUND for an unknown event and 400 for an invalid id', async () => {
    const unknown = await cancel(crypto.randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('EVENT_NOT_FOUND');
    const invalid = await cancel('abc');
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 EVENT_ALREADY_CANCELLED when cancelling twice', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    await cancel(event.id);
    const again = await cancel(event.id);
    expect(again.status).toBe(409);
    expect(again.body).toEqual({
      code: 'EVENT_ALREADY_CANCELLED',
      message: 'Event is already cancelled',
    });
  });

  it('returns 409 EVENT_ALREADY_ENDED for an event whose endDate passed, leaving it ACTIVE', async () => {
    const event = await insertEvent(ctx.db, {
      start_date: new Date(Date.now() - 7200_000).toISOString(),
      end_date: new Date(Date.now() - 3600_000).toISOString(),
    });
    const res = await cancel(event.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EVENT_ALREADY_ENDED');
    expect(await statusOf(event.id)).toBe('ACTIVE');
  });

  it('cancels an event that already started but has not ended', async () => {
    const event = await insertEvent(ctx.db, {
      start_date: new Date(Date.now() - 3600_000).toISOString(),
      end_date: futureDate(1),
    });
    expect((await cancel(event.id)).status).toBe(200);
  });

  it('applies every effect with mixed data and leaves another event intact', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const other = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const seat = async (n: number) => (await seatOf(ctx.db, event.id, 'A', n)).id;
    await insertReservation(ctx.db, { userId, eventId: event.id, seatId: await seat(1) });
    await insertReservation(ctx.db, { userId, eventId: event.id, seatId: await seat(2) });
    await insertReservation(ctx.db, {
      userId,
      eventId: event.id,
      seatId: await seat(3),
      expired: true,
    });
    await insertReservation(ctx.db, {
      userId,
      eventId: event.id,
      seatId: await seat(4),
      status: 'CONFIRMED',
      seatStatus: 'SOLD',
    });
    await insertReservation(ctx.db, {
      userId,
      eventId: other.id,
      seatId: (await seatOf(ctx.db, other.id, 'A', 1)).id,
    });

    const res = await cancel(event.id);
    expect(res.status).toBe(200);
    expect(res.body.cancelledReservations).toBe(2);
    expect(res.body.cancelledTickets).toBe(0);

    const seats = await ctx.db
      .selectFrom('seats')
      .select('status')
      .where('event_id', '=', event.id)
      .execute();
    expect(seats.every((s) => s.status === 'BLOCKED')).toBe(true);
    const reservations = await ctx.db
      .selectFrom('reservations')
      .select('status')
      .where('event_id', '=', event.id)
      .execute();
    expect(reservations.map((r) => r.status).sort()).toEqual([
      'CANCELLED',
      'CANCELLED',
      'CONFIRMED',
      'EXPIRED',
    ]);
    // el otro evento no cambia
    expect(await statusOf(other.id)).toBe('ACTIVE');
    expect((await seatOf(ctx.db, other.id, 'A', 1)).status).toBe('RESERVED');
    expect(
      (
        await ctx.db
          .selectFrom('reservations')
          .select('status')
          .where('event_id', '=', other.id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('ACTIVE');
  });

  it('blocks new reservations and shows no availability after the cancellation', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    await cancel(event.id);

    const reserve = await request(ctx.app)
      .post('/reservations')
      .set(...bearer(userToken))
      .send({ eventId: event.id, seat: 'A1' });
    expect(reserve.status).toBe(409);
    expect(reserve.body.code).toBe('EVENT_NOT_ACTIVE');

    const seats = await request(ctx.app)
      .get(`/events/${event.id}/seats`)
      .query({ status: 'AVAILABLE' })
      .set(...bearer(userToken));
    expect(seats.status).toBe(200);
    expect(seats.body.data).toEqual([]);
  });
});
