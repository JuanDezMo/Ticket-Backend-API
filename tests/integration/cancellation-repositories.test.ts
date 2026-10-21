import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KyselyEventRepository } from '../../src/modules/events/event.repository.js';
import { KyselyReservationRepository } from '../../src/modules/reservations/reservation.repository.js';
import { KyselySeatRepository } from '../../src/modules/seats/seat.repository.js';
import { createUserAndLogin } from '../helpers/auth.js';
import { insertEvent, insertEventWithSeats, insertReservation, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('cancellation building blocks', () => {
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

  const eventStatus = async (id: string) =>
    (
      await ctx.db
        .selectFrom('events')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;
  const seatStatus = async (eventId: string, row: string, n: number) =>
    (await seatOf(ctx.db, eventId, row, n)).status;
  const reservationStatuses = async (eventId: string) =>
    (
      await ctx.db
        .selectFrom('reservations')
        .select('status')
        .where('event_id', '=', eventId)
        .execute()
    )
      .map((r) => r.status)
      .sort();

  describe('EventRepository.markCancelled', () => {
    it('cancels an ACTIVE event once and returns false afterwards', async () => {
      const repo = new KyselyEventRepository(ctx.db);
      const event = await insertEvent(ctx.db);
      expect(await repo.markCancelled(event.id)).toBe(true);
      expect(await eventStatus(event.id)).toBe('CANCELLED');
      expect(await repo.markCancelled(event.id)).toBe(false);
    });

    it('returns false for an unknown event', async () => {
      expect(await new KyselyEventRepository(ctx.db).markCancelled(crypto.randomUUID())).toBe(
        false,
      );
    });
  });

  describe('SeatRepository.blockAllByEvent', () => {
    it('blocks AVAILABLE, RESERVED and SOLD seats and leaves other events untouched', async () => {
      const repo = new KyselySeatRepository(ctx.db);
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const other = await insertEventWithSeats(ctx.db, { capacity: 10 });
      await ctx.db
        .updateTable('seats')
        .set({ status: 'RESERVED' })
        .where('id', '=', (await seatOf(ctx.db, event.id, 'A', 2)).id)
        .execute();
      await ctx.db
        .updateTable('seats')
        .set({ status: 'SOLD' })
        .where('id', '=', (await seatOf(ctx.db, event.id, 'A', 3)).id)
        .execute();

      expect(await repo.blockAllByEvent(event.id)).toBe(10);
      const statuses = await ctx.db
        .selectFrom('seats')
        .select('status')
        .where('event_id', '=', event.id)
        .execute();
      expect(statuses.every((s) => s.status === 'BLOCKED')).toBe(true);
      expect(await seatStatus(other.id, 'A', 1)).toBe('AVAILABLE');
    });

    it('only counts seats that actually changed', async () => {
      const repo = new KyselySeatRepository(ctx.db);
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      await repo.blockAllByEvent(event.id);
      expect(await repo.blockAllByEvent(event.id)).toBe(0);
    });
  });

  describe('ReservationRepository.cancelActiveByEvent', () => {
    it('cancels live reservations, expires the overdue one without counting it, and leaves the rest alone', async () => {
      const repo = new KyselyReservationRepository(ctx.db);
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

      expect(await repo.cancelActiveByEvent(event.id)).toBe(2);
      expect(await reservationStatuses(event.id)).toEqual([
        'CANCELLED',
        'CANCELLED',
        'CONFIRMED',
        'EXPIRED',
      ]);
      expect(await reservationStatuses(other.id)).toEqual(['ACTIVE']);
      expect(await seatStatus(event.id, 'A', 3)).toBe('AVAILABLE'); // la vencida se liberó
    });
  });
});
