import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KyselyEventRepository } from '../../src/modules/events/event.repository.js';
import { KyselyPaymentRepository } from '../../src/modules/payments/payment.repository.js';
import { KyselyReservationRepository } from '../../src/modules/reservations/reservation.repository.js';
import { KyselySeatRepository } from '../../src/modules/seats/seat.repository.js';
import { createUserAndLogin } from '../helpers/auth.js';
import {
  expireReservations,
  insertEvent,
  insertEventWithSeats,
  insertReservation,
  seatOf,
} from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('purchase support in repositories', () => {
  let ctx: TestContext;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    await createUserAndLogin(ctx.app, ctx.db, 'USER');
    userId = (await ctx.db.selectFrom('users').select('id').executeTakeFirstOrThrow()).id;
  });

  describe('PaymentRepository', () => {
    async function reservation() {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const seat = await seatOf(ctx.db, event.id, 'A', 1);
      const res = await insertReservation(ctx.db, { userId, eventId: event.id, seatId: seat.id });
      return { event, res };
    }

    it('records payments and moves them to REFUND_PENDING', async () => {
      const repo = new KyselyPaymentRepository(ctx.db);
      const { event, res } = await reservation();
      const order = await ctx.db
        .insertInto('orders')
        .values({ user_id: userId, event_id: event.id, amount: 150000 })
        .returning('id')
        .executeTakeFirstOrThrow();
      const payment = await repo.create({
        orderId: order.id,
        transactionId: 'txn-1',
        amount: 150000,
        status: 'APPROVED',
      });
      expect(res.id).toBeDefined();
      expect(await repo.existsByTransactionId('txn-1')).toBe(true);
      expect(await repo.existsByTransactionId('txn-unknown')).toBe(false);
      expect(payment).toMatchObject({ transactionId: 'txn-1', amount: 150000, status: 'APPROVED' });
      expect(await repo.markRefundPending([payment.id])).toBe(1);
      const row = await ctx.db
        .selectFrom('payments')
        .select('status')
        .where('id', '=', payment.id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('REFUND_PENDING');
    });

    it('does nothing for an empty list of ids', async () => {
      expect(await new KyselyPaymentRepository(ctx.db).markRefundPending([])).toBe(0);
    });
  });

  describe('EventRepository.findForShare', () => {
    it('reads the event and makes a concurrent cancellation wait until the transaction ends', async () => {
      const repo = new KyselyEventRepository(ctx.db);
      const event = await insertEvent(ctx.db);
      let cancelled = false;
      let cancellation: Promise<boolean> | undefined;

      await ctx.db.transaction().execute(async (trx) => {
        expect(await repo.findForShare(event.id, trx)).toMatchObject({
          id: event.id,
          status: 'ACTIVE',
        });
        cancellation = repo.markCancelled(event.id).then((ok) => {
          cancelled = true;
          return ok;
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(cancelled).toBe(false); // sigue esperando el bloqueo
      });
      expect(await cancellation).toBe(true);
    });

    it('returns null for an unknown event', async () => {
      expect(
        await new KyselyEventRepository(ctx.db).findForShare(crypto.randomUUID(), ctx.db),
      ).toBeNull();
    });
  });

  describe('ReservationRepository', () => {
    const repo = () => new KyselyReservationRepository(ctx.db);

    it('findForPurchase reports expiry with the database clock', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const live = await insertReservation(ctx.db, {
        userId,
        eventId: event.id,
        seatId: (await seatOf(ctx.db, event.id, 'A', 1)).id,
      });
      const old = await insertReservation(ctx.db, {
        userId,
        eventId: event.id,
        seatId: (await seatOf(ctx.db, event.id, 'A', 2)).id,
        expired: true,
      });

      expect((await repo().findForPurchase(live.id))?.expired).toBe(false);
      const found = await repo().findForPurchase(old.id);
      expect(found?.expired).toBe(true);
      expect(found?.reservation).toMatchObject({
        id: old.id,
        userId,
        status: 'ACTIVE',
        amount: 100,
      });
      expect(await repo().findForPurchase(crypto.randomUUID())).toBeNull();
    });

    it('findForPurchase keeps ACTIVE reservations expired by time (before the job releases them)', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const seat = await seatOf(ctx.db, event.id, 'A', 1);
      const res = await insertReservation(ctx.db, { userId, eventId: event.id, seatId: seat.id });
      await expireReservations(ctx.db, seat.id);
      const found = await repo().findForPurchase(res.id);
      expect(found?.reservation.status).toBe('ACTIVE');
      expect(found?.expired).toBe(true);
    });

    it('markConfirmed only changes ACTIVE reservations', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const res = await insertReservation(ctx.db, {
        userId,
        eventId: event.id,
        seatId: (await seatOf(ctx.db, event.id, 'A', 1)).id,
      });
      expect(await repo().markConfirmed(res.id, ctx.db)).toBe(true);
      expect(await repo().markConfirmed(res.id, ctx.db)).toBe(false);
      const status = (
        await ctx.db
          .selectFrom('reservations')
          .select('status')
          .where('id', '=', res.id)
          .executeTakeFirstOrThrow()
      ).status;
      expect(status).toBe('CONFIRMED');
    });

    it('lockById serializes concurrent transactions on the same reservation', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const res = await insertReservation(ctx.db, {
        userId,
        eventId: event.id,
        seatId: (await seatOf(ctx.db, event.id, 'A', 1)).id,
      });
      const order: string[] = [];

      const first = ctx.db.transaction().execute(async (trx) => {
        await repo().lockById(res.id, trx);
        order.push('first-locked');
        await new Promise((resolve) => setTimeout(resolve, 400));
        order.push('first-done');
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const second = ctx.db.transaction().execute(async (trx) => {
        await repo().lockById(res.id, trx);
        order.push('second-locked');
      });
      await Promise.all([first, second]);
      expect(order).toEqual(['first-locked', 'first-done', 'second-locked']);
    });
  });

  describe('SeatRepository.markSold', () => {
    it('moves only a RESERVED seat to SOLD', async () => {
      const repo = new KyselySeatRepository(ctx.db);
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const reserved = await seatOf(ctx.db, event.id, 'A', 1);
      const available = await seatOf(ctx.db, event.id, 'A', 2);
      await ctx.db
        .updateTable('seats')
        .set({ status: 'RESERVED' })
        .where('id', '=', reserved.id)
        .execute();

      expect(await repo.markSold(reserved.id, ctx.db)).toBe(true);
      expect(await repo.markSold(reserved.id, ctx.db)).toBe(false);
      expect(await repo.markSold(available.id, ctx.db)).toBe(false);
      expect((await seatOf(ctx.db, event.id, 'A', 1)).status).toBe('SOLD');
      expect((await seatOf(ctx.db, event.id, 'A', 2)).status).toBe('AVAILABLE');
    });
  });
});
