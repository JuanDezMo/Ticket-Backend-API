import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KyselyReservationRepository } from '../../src/modules/reservations/reservation.repository.js';
import { createUserAndLogin } from '../helpers/auth.js';
import { expireReservations, insertEventWithSeats, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('KyselyReservationRepository', () => {
  let ctx: TestContext;
  let repo: KyselyReservationRepository;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    repo = new KyselyReservationRepository(ctx.db);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    await createUserAndLogin(ctx.app, ctx.db, 'USER');
    userId = (await ctx.db.selectFrom('users').select('id').executeTakeFirstOrThrow()).id;
  });

  /** Crea una reserva ACTIVE y deja el seat RESERVED, como hace el servicio. */
  async function reserve(eventId: string, row: string, number: number) {
    const seat = await seatOf(ctx.db, eventId, row, number);
    await ctx.db
      .updateTable('seats')
      .set({ status: 'RESERVED' })
      .where('id', '=', seat.id)
      .execute();
    const reservation = await repo.create({ userId, seatId: seat.id, eventId, amount: 100 }, 10);
    return { seat, reservation };
  }

  const statusOf = async (seatId: string) =>
    (
      await ctx.db
        .selectFrom('seats')
        .select('status')
        .where('id', '=', seatId)
        .executeTakeFirstOrThrow()
    ).status;
  const reservationStatus = async (id: string) =>
    (
      await ctx.db
        .selectFrom('reservations')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;

  describe('create', () => {
    it.each([10, 3])(
      'sets expires_at to created_at + %i minutes using the database clock',
      async (ttl) => {
        const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
        const seat = await seatOf(ctx.db, event.id, 'A', 1);
        const created = await repo.create(
          { userId, seatId: seat.id, eventId: event.id, amount: 100 },
          ttl,
        );
        const diffMinutes = (created.expiresAt.getTime() - created.createdAt.getTime()) / 60_000;
        expect(diffMinutes).toBeCloseTo(ttl, 1);
        expect(created.status).toBe('ACTIVE');
        expect(created.amount).toBe(100);
      },
    );
  });

  describe('releaseExpired', () => {
    it('expires an overdue reservation and frees its seat', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const { seat, reservation } = await reserve(event.id, 'A', 1);
      await expireReservations(ctx.db, seat.id);

      expect(await repo.releaseExpired()).toBe(1);
      expect(await reservationStatus(reservation.id)).toBe('EXPIRED');
      expect(await statusOf(seat.id)).toBe('AVAILABLE');
    });

    it('does not touch a reservation that has not expired yet', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const { seat, reservation } = await reserve(event.id, 'A', 1);

      expect(await repo.releaseExpired()).toBe(0);
      expect(await reservationStatus(reservation.id)).toBe('ACTIVE');
      expect(await statusOf(seat.id)).toBe('RESERVED');
    });

    it('does not free a seat that is already SOLD', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const { seat } = await reserve(event.id, 'A', 1);
      await ctx.db.updateTable('seats').set({ status: 'SOLD' }).where('id', '=', seat.id).execute();
      await expireReservations(ctx.db, seat.id);

      await repo.releaseExpired();
      expect(await statusOf(seat.id)).toBe('SOLD');
    });

    it('ignores CONFIRMED reservations', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const { seat, reservation } = await reserve(event.id, 'A', 1);
      await ctx.db
        .updateTable('reservations')
        .set({ status: 'CONFIRMED', expires_at: new Date(Date.now() - 60_000) })
        .where('id', '=', reservation.id)
        .execute();

      await repo.releaseExpired();
      expect(await reservationStatus(reservation.id)).toBe('CONFIRMED');
      expect(await statusOf(seat.id)).toBe('RESERVED');
    });

    it('can be limited to one event', async () => {
      const a = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const b = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const ra = await reserve(a.id, 'A', 1);
      const rb = await reserve(b.id, 'A', 1);
      await expireReservations(ctx.db);

      expect(await repo.releaseExpired(a.id)).toBe(1);
      expect(await statusOf(ra.seat.id)).toBe('AVAILABLE');
      expect(await statusOf(rb.seat.id)).toBe('RESERVED');
      expect(await repo.releaseExpired()).toBe(1);
      expect(await statusOf(rb.seat.id)).toBe('AVAILABLE');
    });

    it('is safe when run concurrently', async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      for (const n of [1, 2, 3]) await reserve(event.id, 'A', n);
      await expireReservations(ctx.db);

      const results = await Promise.all(Array.from({ length: 4 }, () => repo.releaseExpired()));
      expect(results.reduce((a, b) => a + b, 0)).toBe(3);
      const seats = await ctx.db
        .selectFrom('seats')
        .select('status')
        .where('event_id', '=', event.id)
        .execute();
      expect(seats.every((s) => s.status === 'AVAILABLE')).toBe(true);
    });
  });
});
