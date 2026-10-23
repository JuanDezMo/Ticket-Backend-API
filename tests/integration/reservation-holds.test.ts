import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KyselyReservationRepository } from '../../src/modules/reservations/reservation.repository.js';
import { createUserAndLogin } from '../helpers/auth.js';
import { expireReservations, insertEventWithSeats, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('reservation holds: counts, lock and batch insert', () => {
  let ctx: TestContext;
  let repo: KyselyReservationRepository;
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    repo = new KyselyReservationRepository(ctx.db);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    userId = (await createUserAndLogin(ctx.app, ctx.db, 'USER', 'a@mail.com')).userId;
    otherUserId = (await createUserAndLogin(ctx.app, ctx.db, 'USER', 'b@mail.com')).userId;
  });

  /** Inserta una reserva en el estado indicado (vigente o ya vencida). */
  async function insertHold(
    owner: string,
    eventId: string,
    seatNumber: number,
    status: string,
    expired = false,
  ) {
    const seat = await seatOf(ctx.db, eventId, 'A', seatNumber);
    await ctx.db
      .insertInto('reservations')
      .values({
        user_id: owner,
        seat_id: seat.id,
        event_id: eventId,
        amount: 100,
        status,
        expires_at: new Date(Date.now() + (expired ? -60_000 : 600_000)),
      })
      .execute();
  }

  describe('createMany', () => {
    it('shares created_at and expires_at across the batch', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const seats = await Promise.all([1, 2, 3].map((n) => seatOf(ctx.db, event.id, 'A', n)));

      const created = await repo.createMany(
        seats.map((seat) => ({ userId, seatId: seat.id, eventId: event.id, amount: 100 })),
        10,
      );

      expect(created).toHaveLength(3);
      expect(new Set(created.map((r) => r.createdAt.getTime())).size).toBe(1);
      expect(new Set(created.map((r) => r.expiresAt.getTime())).size).toBe(1);
      const ttlMs = created[0]!.expiresAt.getTime() - created[0]!.createdAt.getTime();
      expect(ttlMs).toBe(10 * 60_000);
    });

    it('inserts 1 and 8 reservations in one statement', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      for (const size of [1, 8]) {
        await ctx.db.deleteFrom('reservations').execute();
        const seats = await Promise.all(
          Array.from({ length: size }, (_, i) => seatOf(ctx.db, event.id, 'A', i + 1)),
        );
        const created = await repo.createMany(
          seats.map((seat) => ({ userId, seatId: seat.id, eventId: event.id, amount: 50 })),
          10,
        );
        expect(created).toHaveLength(size);
      }
    });

    it('creates nothing when one of the seats already has an active reservation', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      await insertHold(otherUserId, event.id, 2, 'ACTIVE');
      const seats = await Promise.all([1, 2, 3].map((n) => seatOf(ctx.db, event.id, 'A', n)));

      await expect(
        repo.createMany(
          seats.map((seat) => ({ userId, seatId: seat.id, eventId: event.id, amount: 100 })),
          10,
        ),
      ).rejects.toThrow();

      const mine = await ctx.db
        .selectFrom('reservations')
        .select('id')
        .where('user_id', '=', userId)
        .execute();
      expect(mine).toHaveLength(0);
    });

    it('returns an empty list for an empty batch', async () => {
      expect(await repo.createMany([], 10)).toEqual([]);
    });
  });

  describe('countHoldsForEvent', () => {
    it('counts ACTIVE not expired and CONFIRMED, and nothing else', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      await insertHold(userId, event.id, 1, 'ACTIVE');
      await insertHold(userId, event.id, 2, 'CONFIRMED');
      await insertHold(userId, event.id, 3, 'EXPIRED');
      await insertHold(userId, event.id, 4, 'CANCELLED');
      await insertHold(userId, event.id, 5, 'CANCELLED_BY_USER');
      // ACTIVE pero ya vencida según la hora de la BD, aunque el job no la haya liberado
      await insertHold(userId, event.id, 6, 'ACTIVE', true);
      await insertHold(otherUserId, event.id, 7, 'ACTIVE');

      expect(await repo.countHoldsForEvent(userId, event.id)).toBe(2);
      expect(await repo.countHoldsForEvent(otherUserId, event.id)).toBe(1);
    });

    it.each([0, 1, 8])('counts exactly %i holds', async (total) => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      for (let n = 1; n <= total; n++) await insertHold(userId, event.id, n, 'ACTIVE');
      expect(await repo.countHoldsForEvent(userId, event.id)).toBe(total);
    });

    it('is per event', async () => {
      const a = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const b = await insertEventWithSeats(ctx.db, { capacity: 10 });
      await insertHold(userId, a.id, 1, 'ACTIVE');
      await insertHold(userId, b.id, 1, 'ACTIVE');
      await insertHold(userId, b.id, 2, 'ACTIVE');
      expect(await repo.countHoldsForEvent(userId, a.id)).toBe(1);
      expect(await repo.countHoldsForEvent(userId, b.id)).toBe(2);
    });
  });

  describe('countActiveHolds', () => {
    it('counts ACTIVE not expired of every event and ignores CONFIRMED', async () => {
      const a = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const b = await insertEventWithSeats(ctx.db, { capacity: 10 });
      await insertHold(userId, a.id, 1, 'ACTIVE');
      await insertHold(userId, b.id, 1, 'ACTIVE');
      await insertHold(userId, b.id, 2, 'CONFIRMED');
      await insertHold(userId, b.id, 3, 'ACTIVE', true);
      await insertHold(userId, b.id, 4, 'CANCELLED_BY_USER');

      expect(await repo.countActiveHolds(userId)).toBe(2);
      expect(await repo.countActiveHolds(otherUserId)).toBe(0);
    });

    it.each([0, 1, 8])('counts exactly %i active holds', async (total) => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      for (let n = 1; n <= total; n++) await insertHold(userId, event.id, n, 'ACTIVE');
      expect(await repo.countActiveHolds(userId)).toBe(total);
    });
  });

  describe('lockHoldsOf', () => {
    const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    it('serializes two transactions of the same user', async () => {
      const order: string[] = [];
      let releaseFirst!: () => void;
      const firstMayFinish = new Promise<void>((resolve) => (releaseFirst = resolve));

      const first = ctx.db.transaction().execute(async (trx) => {
        await repo.lockHoldsOf(userId, trx);
        order.push('first locked');
        await firstMayFinish;
        order.push('first done');
      });
      await settle(150);
      const second = ctx.db.transaction().execute(async (trx) => {
        await repo.lockHoldsOf(userId, trx);
        order.push('second locked');
      });
      await settle(300);
      // La segunda sigue esperando mientras la primera conserva el bloqueo
      expect(order).toEqual(['first locked']);

      releaseFirst();
      await Promise.all([first, second]);
      expect(order).toEqual(['first locked', 'first done', 'second locked']);
    });

    it('does not block transactions of different users', async () => {
      let releaseFirst!: () => void;
      const firstMayFinish = new Promise<void>((resolve) => (releaseFirst = resolve));
      let secondLocked = false;

      const first = ctx.db.transaction().execute(async (trx) => {
        await repo.lockHoldsOf(userId, trx);
        await firstMayFinish;
      });
      await settle(150);
      await ctx.db.transaction().execute(async (trx) => {
        await repo.lockHoldsOf(otherUserId, trx);
        secondLocked = true;
      });
      expect(secondLocked).toBe(true);

      releaseFirst();
      await first;
    });
  });

  describe('releaseExpired without crossed waits', () => {
    async function expiredFixture(count: number) {
      const event = await insertEventWithSeats(ctx.db, { capacity: 20 });
      for (let n = 1; n <= count; n++) {
        const seat = await seatOf(ctx.db, event.id, 'A', n);
        await ctx.db
          .updateTable('seats')
          .set({ status: 'RESERVED' })
          .where('id', '=', seat.id)
          .execute();
        await insertHold(userId, event.id, n, 'ACTIVE');
      }
      await expireReservations(ctx.db);
      return event;
    }

    it('frees every expired reservation and its seat', async () => {
      const event = await expiredFixture(5);

      await repo.releaseExpired(event.id);

      const active = await ctx.db
        .selectFrom('reservations')
        .select('id')
        .where('status', '=', 'ACTIVE')
        .execute();
      const reserved = await ctx.db
        .selectFrom('seats')
        .select('id')
        .where('status', '=', 'RESERVED')
        .execute();
      expect(active).toHaveLength(0);
      expect(reserved).toHaveLength(0);
    });

    it('survives two transactions releasing the same reservations in parallel, 20 times', async () => {
      for (let round = 0; round < 20; round++) {
        await ctx.db.deleteFrom('reservations').execute();
        await ctx.db.updateTable('seats').set({ status: 'AVAILABLE' }).execute();
        const event = await expiredFixture(8);

        await Promise.all([
          ctx.db.transaction().execute((trx) => repo.releaseExpired(event.id, trx)),
          ctx.db.transaction().execute((trx) => repo.releaseExpired(event.id, trx)),
        ]);

        const expired = await ctx.db
          .selectFrom('reservations')
          .select('id')
          .where('status', '=', 'EXPIRED')
          .execute();
        const active = await ctx.db
          .selectFrom('reservations')
          .select('id')
          .where('status', '=', 'ACTIVE')
          .execute();
        const reserved = await ctx.db
          .selectFrom('seats')
          .select('id')
          .where('status', '=', 'RESERVED')
          .execute();
        expect(expired).toHaveLength(8);
        expect(active).toHaveLength(0);
        expect(reserved).toHaveLength(0);
      }
    });

    it('does not touch a seat that is no longer RESERVED', async () => {
      const event = await expiredFixture(2);
      const seat = await seatOf(ctx.db, event.id, 'A', 1);
      await ctx.db.updateTable('seats').set({ status: 'SOLD' }).where('id', '=', seat.id).execute();

      await repo.releaseExpired(event.id);

      expect((await seatOf(ctx.db, event.id, 'A', 1)).status).toBe('SOLD');
      expect((await seatOf(ctx.db, event.id, 'A', 2)).status).toBe('AVAILABLE');
    });
  });
});
