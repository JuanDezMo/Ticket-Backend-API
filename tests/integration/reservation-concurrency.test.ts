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

// Cada prueba repite la carrera muchas veces: un fallo ocasional delataría una condición de carrera
const ROUNDS = 20;

describe('concurrent reservations respect the limits', () => {
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

  const reserve = (app: TestContext['app'], token: string, eventId: string, seats: string[]) =>
    request(app)
      .post('/reservations')
      .set(...bearer(token))
      .send({ eventId, seats });
  const statusesOf = (results: { status: number }[]) => results.map((r) => r.status).sort();
  const activeOf = (db: TestContext['db'], userId: string) =>
    db
      .selectFrom('reservations')
      .select('id')
      .where('user_id', '=', userId)
      .where('status', '=', 'ACTIVE')
      .execute();
  async function clean(db: TestContext['db']) {
    await db.deleteFrom('reservations').execute();
    await db.updateTable('seats').set({ status: 'AVAILABLE' }).execute();
  }

  it(`never lets one user pass an event limit of 2 with 1 already held (${ROUNDS} rounds)`, async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 20, max_seats_per_user: 2 });
    for (let round = 0; round < ROUNDS; round++) {
      await clean(ctx.db);
      await reserve(ctx.app, ana.token, event.id, ['A1']);

      const results = await Promise.all([
        reserve(ctx.app, ana.token, event.id, ['B1']),
        reserve(ctx.app, ana.token, event.id, ['B2']),
      ]);

      expect(statusesOf(results)).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)?.body.code).toBe('SEAT_LIMIT_REACHED');
      expect(await activeOf(ctx.db, ana.userId)).toHaveLength(2);
    }
  });

  it('admits exactly the limit when 8 requests of one user arrive at once (10 rounds)', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 20, max_seats_per_user: 4 });
    for (let round = 0; round < 10; round++) {
      await clean(ctx.db);

      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => reserve(ctx.app, ana.token, event.id, [`A${i + 1}`])),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(4);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(results.every((r) => r.status < 500)).toBe(true);
      expect(await activeOf(ctx.db, ana.userId)).toHaveLength(4);
    }
  });

  it(`does not deadlock two batches that cross (${ROUNDS} rounds)`, async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 20, max_seats_per_user: 4 });
    for (let round = 0; round < ROUNDS; round++) {
      await clean(ctx.db);

      const results = await Promise.all([
        reserve(ctx.app, ana.token, event.id, ['A5', 'A6']),
        reserve(ctx.app, luis.token, event.id, ['A6', 'A5']),
      ]);

      expect(statusesOf(results)).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)?.body.code).toBe('SEAT_NOT_AVAILABLE');
      const active = await ctx.db
        .selectFrom('reservations')
        .select('id')
        .where('status', '=', 'ACTIVE')
        .execute();
      expect(active).toHaveLength(2);
    }
  });

  it(`reserves expired seats without deadlocks while other users reserve them (${ROUNDS} rounds)`, async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 20, max_seats_per_user: 8 });
    const third = await createUserAndLogin(ctx.app, ctx.db, 'USER', 'third@mail.com');
    for (let round = 0; round < ROUNDS; round++) {
      await clean(ctx.db);
      for (let n = 1; n <= 8; n++) {
        await insertReservation(ctx.db, {
          userId: third.userId,
          eventId: event.id,
          seatId: (await seatOf(ctx.db, event.id, 'A', n)).id,
        });
      }
      await expireReservations(ctx.db);

      const results = await Promise.all([
        reserve(ctx.app, ana.token, event.id, ['A1', 'A2', 'A3', 'A4']),
        reserve(ctx.app, luis.token, event.id, ['A4', 'A3', 'A2', 'A1']),
        reserve(ctx.app, ana.token, event.id, ['A5', 'A6']),
      ]);

      const unexpected = results.filter((r) => r.status !== 201 && r.status !== 409);
      expect(unexpected.map((r) => `${r.status} ${JSON.stringify(r.body)}`)).toEqual([]);
      expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
      const reserved = await ctx.db
        .selectFrom('seats')
        .select('id')
        .where('status', '=', 'RESERVED')
        .execute();
      const active = await ctx.db
        .selectFrom('reservations')
        .select('id')
        .where('status', '=', 'ACTIVE')
        .execute();
      // Cada seat reservado tiene exactamente una reserva activa
      expect(active).toHaveLength(reserved.length);
    }
  });

  it('lets exactly one user take a seat when several ask for it together', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10, max_seats_per_user: 4 });
    const others = await Promise.all(
      [1, 2, 3].map((i) => createUserAndLogin(ctx.app, ctx.db, 'USER', `u${i}@mail.com`)),
    );
    const tokens = [ana.token, luis.token, ...others.map((u) => u.token)];

    const results = await Promise.all(tokens.map((t) => reserve(ctx.app, t, event.id, ['A1'])));

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });

  describe('global cap', () => {
    let capped: TestContext;
    let user: { token: string; userId: string };

    beforeAll(async () => {
      capped = await createTestContext({ MAX_ACTIVE_HOLDS_PER_USER: '2' });
    });
    afterAll(async () => {
      await capped.close();
    });
    beforeEach(async () => {
      await capped.reset();
      user = await createUserAndLogin(capped.app, capped.db, 'USER', 'cap@mail.com');
    });

    it('never exceeds the cap with parallel requests over two events (10 rounds)', async () => {
      const a = await insertEventWithSeats(capped.db, { capacity: 20, max_seats_per_user: 8 });
      const b = await insertEventWithSeats(capped.db, { capacity: 20, max_seats_per_user: 8 });
      for (let round = 0; round < 10; round++) {
        await clean(capped.db);

        const results = await Promise.all(
          [a, b, a, b, a, b].map((event, i) =>
            reserve(capped.app, user.token, event.id, [`A${i + 1}`]),
          ),
        );

        expect(results.filter((r) => r.status === 201)).toHaveLength(2);
        expect(results.filter((r) => r.status === 409)).toHaveLength(4);
        expect(
          results
            .filter((r) => r.status === 409)
            .every((r) => r.body.code === 'HOLD_LIMIT_REACHED'),
        ).toBe(true);
        expect(await activeOf(capped.db, user.userId)).toHaveLength(2);
      }
    });
  });
});
