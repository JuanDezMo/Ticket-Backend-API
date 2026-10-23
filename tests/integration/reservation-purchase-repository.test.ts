import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KyselyOrderRepository } from '../../src/modules/orders/order.repository.js';
import { KyselyReservationRepository } from '../../src/modules/reservations/reservation.repository.js';
import { createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats, insertReservation, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('reservation repository: purchase support', () => {
  let ctx: TestContext;
  let repo: KyselyReservationRepository;
  let userId: string;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    repo = new KyselyReservationRepository(ctx.db);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    userId = (await createUserAndLogin(ctx.app, ctx.db, 'USER')).userId;
    eventId = (await insertEventWithSeats(ctx.db, { capacity: 20, max_seats_per_user: 8 })).id;
  });

  async function holds(count: number, options: { expired?: boolean } = {}) {
    const ids: string[] = [];
    for (let n = 1; n <= count; n++) {
      const seatId = (await seatOf(ctx.db, eventId, 'A', n)).id;
      ids.push((await insertReservation(ctx.db, { userId, eventId, seatId, ...options })).id);
    }
    return ids;
  }
  const claimOf = async (id: string) =>
    (
      await ctx.db
        .selectFrom('reservations')
        .select('payment_started_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).payment_started_at;
  const setClaim = (id: string, secondsAgo: number) =>
    ctx.db
      .updateTable('reservations')
      .set({ payment_started_at: new Date(Date.now() - secondsAgo * 1000) })
      .where('id', '=', id)
      .execute();

  describe('findManyForPurchase and lockManyByIds', () => {
    it('returns the existing reservations, flagging the expired ones by the database clock', async () => {
      const [live] = await holds(1);
      const seatId = (await seatOf(ctx.db, eventId, 'A', 2)).id;
      const old = await insertReservation(ctx.db, { userId, eventId, seatId, expired: true });

      const found = await repo.findManyForPurchase([live!, old.id, crypto.randomUUID()]);

      expect(found).toHaveLength(2);
      expect(found.find((f) => f.reservation.id === live)?.expired).toBe(false);
      expect(found.find((f) => f.reservation.id === old.id)?.expired).toBe(true);
    });

    it('locks the reservations in ascending id order whatever order they are requested in', async () => {
      const ids = await holds(8);
      const locked = await ctx.db
        .transaction()
        .execute((trx) => repo.lockManyByIds([...ids].reverse(), trx));
      const got = locked.map((r) => r.id);
      expect(got).toEqual([...got].sort());
      expect(got).toHaveLength(8);
    });
  });

  describe('claimForPayment', () => {
    it.each([1, 8])('claims %i reservation(s) at once', async (size) => {
      const ids = await holds(size);
      expect(await repo.claimForPayment(ids, 30)).toBe(true);
      for (const id of ids) expect(await claimOf(id)).not.toBeNull();
    });

    it('refuses a second claim of the same reservations while the first is recent', async () => {
      const ids = await holds(2);
      expect(await repo.claimForPayment(ids, 30)).toBe(true);
      expect(await repo.claimForPayment(ids, 30)).toBe(false);
    });

    it('claims nothing when one of them is already claimed (all or nothing)', async () => {
      const [a, b, c] = await holds(3);
      await setClaim(b!, 1);
      expect(await repo.claimForPayment([a!, b!, c!], 30)).toBe(false);
      expect(await claimOf(a!)).toBeNull();
      expect(await claimOf(c!)).toBeNull();
    });

    it.each([
      [29, false],
      [31, true],
    ])('a claim made %i seconds ago allows a new claim: %s', async (seconds, allowed) => {
      const [id] = await holds(1);
      await setClaim(id!, seconds);
      expect(await repo.claimForPayment([id!], 30)).toBe(allowed);
    });

    it('does not claim reservations that are not ACTIVE or already expired', async () => {
      const [live] = await holds(1);
      const expiredSeat = (await seatOf(ctx.db, eventId, 'A', 2)).id;
      const expired = await insertReservation(ctx.db, {
        userId,
        eventId,
        seatId: expiredSeat,
        expired: true,
      });
      const paidSeat = (await seatOf(ctx.db, eventId, 'A', 3)).id;
      const paid = await insertReservation(ctx.db, {
        userId,
        eventId,
        seatId: paidSeat,
        status: 'CONFIRMED',
      });

      expect(await repo.claimForPayment([live!, expired.id], 30)).toBe(false);
      expect(await repo.claimForPayment([live!, paid.id], 30)).toBe(false);
      expect(await claimOf(live!)).toBeNull();
    });

    it('does not wait for a reservation locked by another transaction', async () => {
      const [a, b] = await holds(2);
      let release!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve));
      const locker = ctx.db.transaction().execute(async (trx) => {
        await repo.lockManyByIds([b!], trx);
        await hold;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));

      const started = Date.now();
      const claimed = await repo.claimForPayment([a!, b!], 30);

      expect(claimed).toBe(false);
      expect(Date.now() - started).toBeLessThan(1000);
      release();
      await locker;
      expect(await claimOf(a!)).toBeNull();
    });

    it('tells a real payment in progress from a stale or missing claim', async () => {
      const [a, b] = await holds(2);
      expect(await repo.hasRecentClaim([a!, b!], 30)).toBe(false);

      await repo.claimForPayment([a!], 30);
      expect(await repo.hasRecentClaim([a!, b!], 30)).toBe(true);
      expect(await repo.hasRecentClaim([b!], 30)).toBe(false);

      await setClaim(a!, 45);
      expect(await repo.hasRecentClaim([a!], 30)).toBe(false);
    });

    it('releases only the reservations indicated', async () => {
      const [a, b] = await holds(2);
      await repo.claimForPayment([a!, b!], 30);
      await repo.releaseClaim([a!]);
      expect(await claimOf(a!)).toBeNull();
      expect(await claimOf(b!)).not.toBeNull();
    });
  });

  describe('markConfirmedMany and attachToOrder', () => {
    it('confirms the ACTIVE reservations, clears the claim and counts only what changed', async () => {
      const ids = await holds(3);
      await repo.claimForPayment(ids, 30);
      await ctx.db
        .updateTable('reservations')
        .set({ status: 'EXPIRED' })
        .where('id', '=', ids[2]!)
        .execute();

      const changed = await ctx.db.transaction().execute((trx) => repo.markConfirmedMany(ids, trx));

      expect(changed).toBe(2);
      expect(await claimOf(ids[0]!)).toBeNull();
    });

    it('attaches reservations to an order', async () => {
      const ids = await holds(2);
      const order = await new KyselyOrderRepository(ctx.db).create({
        userId,
        eventId,
        amount: 200,
      });
      await ctx.db.transaction().execute((trx) => repo.attachToOrder(ids, order.id, trx));
      const rows = await ctx.db.selectFrom('reservations').select('order_id').execute();
      expect(rows.map((r) => r.order_id)).toEqual([order.id, order.id]);
    });
  });
});

describe('KyselyOrderRepository', () => {
  it('creates an order with the total amount', async () => {
    const ctx = await createTestContext();
    try {
      await ctx.reset();
      const { userId } = await createUserAndLogin(ctx.app, ctx.db, 'USER');
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const order = await new KyselyOrderRepository(ctx.db).create({
        userId,
        eventId: event.id,
        amount: 9_999_999_999.99,
      });
      expect(order).toMatchObject({ userId, eventId: event.id, amount: 9_999_999_999.99 });
    } finally {
      await ctx.close();
    }
  });
});
