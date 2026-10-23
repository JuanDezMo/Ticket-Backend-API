import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import {
  expireReservations,
  insertEventWithSeats,
  insertReservation,
  seatOf,
} from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('reservation batches and limits', () => {
  let ctx: TestContext;
  let ana: { token: string; userId: string };
  let luis: { token: string; userId: string };

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    ana = await createUserAndLogin(ctx.app, ctx.db, 'USER', 'ana@mail.com');
    luis = await createUserAndLogin(ctx.app, ctx.db, 'USER', 'luis@mail.com');
  });

  const reserve = (token: string, eventId: string, seats: string[]) =>
    request(ctx.app)
      .post('/reservations')
      .set(...bearer(token))
      .send({ eventId, seats });
  const labels = (count: number, row = 'A') =>
    Array.from({ length: count }, (_, i) => `${row}${i + 1}`);
  const newEvent = (limit: number, capacity = 30) =>
    insertEventWithSeats(ctx.db, { capacity, max_seats_per_user: limit });
  const rowsOf = (userId: string) =>
    ctx.db.selectFrom('reservations').selectAll().where('user_id', '=', userId).execute();
  const seatStatus = async (eventId: string, label: string) =>
    (await seatOf(ctx.db, eventId, label[0]!, Number(label.slice(1)))).status;
  const idOf = async (eventId: string, label: string) =>
    (await seatOf(ctx.db, eventId, label[0]!, Number(label.slice(1)))).id;

  describe('batch of seats', () => {
    it('reserves one seat', async () => {
      const event = await newEvent(4);
      const res = await reserve(ana.token, event.id, ['A1']);
      expect(res.status).toBe(201);
      expect(res.body.reservations).toHaveLength(1);
      expect(await seatStatus(event.id, 'A1')).toBe('RESERVED');
    });

    it('reserves three seats in the requested order with a common expiry', async () => {
      const event = await newEvent(4);
      const res = await reserve(ana.token, event.id, ['C5', 'A1', 'B3']);
      expect(res.status).toBe(201);
      const list = res.body.reservations as {
        seat: string;
        expiresAt: string;
        createdAt: string;
      }[];
      expect(list.map((r) => r.seat)).toEqual(['C5', 'A1', 'B3']);
      expect(new Set(list.map((r) => r.expiresAt)).size).toBe(1);
      expect(new Set(list.map((r) => r.createdAt)).size).toBe(1);
      for (const label of ['C5', 'A1', 'B3']) {
        expect(await seatStatus(event.id, label)).toBe('RESERVED');
      }
    });

    it('reserves nothing when one seat of the batch is taken, and names it', async () => {
      const event = await newEvent(4);
      await reserve(luis.token, event.id, ['A2']);

      const res = await reserve(ana.token, event.id, ['A1', 'A2', 'A3']);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SEAT_NOT_AVAILABLE');
      expect(res.body.message).toBe('Seats not available: A2');
      expect(await seatStatus(event.id, 'A1')).toBe('AVAILABLE');
      expect(await seatStatus(event.id, 'A3')).toBe('AVAILABLE');
      expect(await rowsOf(ana.userId)).toHaveLength(0);
    });

    it('names every taken seat and reserves nothing', async () => {
      const event = await newEvent(4);
      await ctx.db
        .updateTable('seats')
        .set({ status: 'SOLD' })
        .where('id', '=', await idOf(event.id, 'A2'))
        .execute();
      await ctx.db
        .updateTable('seats')
        .set({ status: 'BLOCKED' })
        .where('id', '=', await idOf(event.id, 'A3'))
        .execute();

      const res = await reserve(ana.token, event.id, ['A1', 'A2', 'A3']);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Seats not available: A2, A3');
      expect(await seatStatus(event.id, 'A1')).toBe('AVAILABLE');
    });

    it('answers 404 SEAT_NOT_FOUND and reserves none when one label does not exist', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10, max_seats_per_user: 4 });
      const res = await reserve(ana.token, event.id, ['A1', 'C7']);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('SEAT_NOT_FOUND');
      expect(await seatStatus(event.id, 'A1')).toBe('AVAILABLE');
    });

    it('rejects the old single-seat field and a batch of 0 or 9 seats', async () => {
      const event = await newEvent(8);
      const old = await request(ctx.app)
        .post('/reservations')
        .set(...bearer(ana.token))
        .send({ eventId: event.id, seat: 'A1' });
      expect(old.status).toBe(400);
      expect((await reserve(ana.token, event.id, [])).status).toBe(400);
      expect((await reserve(ana.token, event.id, labels(9))).status).toBe(400);
    });
  });

  describe('limit per event', () => {
    it('with a limit of 1: the first reservation passes and the second is refused', async () => {
      const event = await newEvent(1);
      expect((await reserve(ana.token, event.id, ['A1'])).status).toBe(201);

      const second = await reserve(ana.token, event.id, ['A2']);

      expect(second.status).toBe(409);
      expect(second.body.code).toBe('SEAT_LIMIT_REACHED');
      expect(second.body.message).toBe('You can hold up to 1 seats for this event');
      expect(await seatStatus(event.id, 'A2')).toBe('AVAILABLE');
    });

    it('with a limit of 8: a batch of 8 passes and one more is refused', async () => {
      const event = await newEvent(8);
      expect((await reserve(ana.token, event.id, labels(8))).status).toBe(201);
      const more = await reserve(ana.token, event.id, ['B1']);
      expect(more.status).toBe(409);
      expect(more.body.code).toBe('SEAT_LIMIT_REACHED');
    });

    it('with a limit of 4 and 3 held: one more passes, two more are refused and none is reserved', async () => {
      const event = await newEvent(4);
      await reserve(ana.token, event.id, labels(3));

      const two = await reserve(ana.token, event.id, ['B1', 'B2']);
      expect(two.status).toBe(409);
      expect(two.body.code).toBe('SEAT_LIMIT_REACHED');
      expect(await seatStatus(event.id, 'B1')).toBe('AVAILABLE');
      expect(await seatStatus(event.id, 'B2')).toBe('AVAILABLE');

      expect((await reserve(ana.token, event.id, ['B1'])).status).toBe(201);
      expect((await reserve(ana.token, event.id, ['B2'])).status).toBe(409);
    });

    it('counts the tickets already bought (CONFIRMED reservations)', async () => {
      const event = await newEvent(4);
      for (const label of labels(4)) {
        await insertReservation(ctx.db, {
          userId: ana.userId,
          eventId: event.id,
          seatId: await idOf(event.id, label),
          status: 'CONFIRMED',
          seatStatus: 'SOLD',
        });
      }
      const res = await reserve(ana.token, event.id, ['B1']);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SEAT_LIMIT_REACHED');
    });

    it.each(['EXPIRED', 'CANCELLED', 'CANCELLED_BY_USER'])(
      'does not count %s reservations',
      async (status) => {
        const event = await newEvent(2);
        for (const label of ['A1', 'A2']) {
          await insertReservation(ctx.db, {
            userId: ana.userId,
            eventId: event.id,
            seatId: await idOf(event.id, label),
            status,
            seatStatus: 'AVAILABLE',
          });
        }
        expect((await reserve(ana.token, event.id, ['B1', 'B2'])).status).toBe(201);
      },
    );

    it('does not count an ACTIVE reservation that already expired', async () => {
      const event = await newEvent(1);
      await reserve(ana.token, event.id, ['A1']);
      await expireReservations(ctx.db);
      expect((await reserve(ana.token, event.id, ['A2'])).status).toBe(201);
    });

    it('is per event and per user', async () => {
      const first = await newEvent(1);
      const second = await newEvent(1);
      await reserve(ana.token, first.id, ['A1']);
      expect((await reserve(ana.token, second.id, ['A1'])).status).toBe(201);
      expect((await reserve(luis.token, first.id, ['A2'])).status).toBe(201);
    });
  });

  describe('global cap on active holds', () => {
    it('with the default cap of 8: 8 holds across two events pass and the ninth is refused', async () => {
      const first = await newEvent(8);
      const second = await newEvent(8);
      expect((await reserve(ana.token, first.id, labels(4))).status).toBe(201);
      expect((await reserve(ana.token, second.id, labels(4))).status).toBe(201);

      const ninth = await reserve(ana.token, first.id, ['B1']);

      expect(ninth.status).toBe(409);
      expect(ninth.body.code).toBe('HOLD_LIMIT_REACHED');
      expect(await seatStatus(first.id, 'B1')).toBe('AVAILABLE');
    });

    it('does not count what was already bought', async () => {
      const first = await newEvent(8);
      const second = await newEvent(8);
      for (const label of labels(8)) {
        await insertReservation(ctx.db, {
          userId: ana.userId,
          eventId: first.id,
          seatId: await idOf(first.id, label),
          status: 'CONFIRMED',
          seatStatus: 'SOLD',
        });
      }
      expect((await reserve(ana.token, second.id, ['A1'])).status).toBe(201);
    });

    it('answers the event limit before the seat availability', async () => {
      const event = await newEvent(1);
      await reserve(ana.token, event.id, ['A1']);
      await reserve(luis.token, event.id, ['A2']);
      const res = await reserve(ana.token, event.id, ['A2']);
      expect(res.body.code).toBe('SEAT_LIMIT_REACHED');
    });
  });

  describe('with a cap of 1', () => {
    let capped: TestContext;
    let user: { token: string; userId: string };

    beforeAll(async () => {
      capped = await createTestContext({ MAX_ACTIVE_HOLDS_PER_USER: '1' });
    });
    afterAll(async () => {
      await capped.close();
    });
    beforeEach(async () => {
      await capped.reset();
      user = await createUserAndLogin(capped.app, capped.db, 'USER', 'cap@mail.com');
    });

    it('refuses the second active hold even in another event, and answers HOLD_LIMIT_REACHED', async () => {
      const first = await insertEventWithSeats(capped.db, { capacity: 10, max_seats_per_user: 4 });
      const second = await insertEventWithSeats(capped.db, { capacity: 10, max_seats_per_user: 4 });
      const post = (eventId: string, seats: string[]) =>
        request(capped.app)
          .post('/reservations')
          .set(...bearer(user.token))
          .send({ eventId, seats });

      expect((await post(first.id, ['A1'])).status).toBe(201);
      const refused = await post(second.id, ['A1']);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('HOLD_LIMIT_REACHED');
    });
  });
});
