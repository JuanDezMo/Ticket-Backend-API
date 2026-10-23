import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../../src/shared/utils/db-errors.js';
import { createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats, insertReservation, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('orders, payments and tickets schema', () => {
  let ctx: TestContext;
  let userId: string;
  let eventId: string;
  const seatIds: string[] = [];
  const reservationIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    seatIds.length = 0;
    reservationIds.length = 0;
    await createUserAndLogin(ctx.app, ctx.db, 'USER');
    userId = (await ctx.db.selectFrom('users').select('id').executeTakeFirstOrThrow()).id;
    eventId = (await insertEventWithSeats(ctx.db, { capacity: 10 })).id;
    for (const n of [1, 2]) {
      const seatId = (await seatOf(ctx.db, eventId, 'A', n)).id;
      seatIds.push(seatId);
      reservationIds.push((await insertReservation(ctx.db, { userId, eventId, seatId })).id);
    }
  });

  const orders: string[] = [];
  const order = async () => {
    const row = await ctx.db
      .insertInto('orders')
      .values({ user_id: userId, event_id: eventId, amount: 100 })
      .returning('id')
      .executeTakeFirstOrThrow();
    orders.push(row.id);
    return row.id;
  };
  const payment = (orderId: string, transactionId: string, status = 'APPROVED') =>
    ctx.db
      .insertInto('payments')
      .values({ order_id: orderId, transaction_id: transactionId, amount: 100, status })
      .returning('id')
      .executeTakeFirstOrThrow();
  const ticket = (
    reservationId: string,
    orderId: string,
    paymentId: string,
    seatId: string,
    status = 'ISSUED',
  ) =>
    ctx.db
      .insertInto('tickets')
      .values({
        reservation_id: reservationId,
        order_id: orderId,
        payment_id: paymentId,
        user_id: userId,
        event_id: eventId,
        seat_id: seatId,
        amount: 100,
        status,
      })
      .execute();

  it('rejects a second payment for the same order and a repeated transaction id', async () => {
    const first = await order();
    await payment(first, 'txn-1');
    await expect(payment(first, 'txn-2')).rejects.toSatisfy(isUniqueViolation);
    await expect(payment(await order(), 'txn-1')).rejects.toSatisfy(isUniqueViolation);
  });

  it('lets several tickets of one order share the same payment, one ticket per reservation', async () => {
    const o = await order();
    const p = await payment(o, 'txn-1');
    await ticket(reservationIds[0]!, o, p.id, seatIds[0]!);
    await expect(ticket(reservationIds[1]!, o, p.id, seatIds[1]!)).resolves.toBeDefined();
    // Una reserva solo puede tener un ticket
    await expect(ticket(reservationIds[0]!, o, p.id, seatIds[0]!)).rejects.toSatisfy(
      isUniqueViolation,
    );
  });

  it('rejects invalid statuses', async () => {
    const o = await order();
    await expect(payment(o, 'txn-1', 'PAID')).rejects.toThrow();
    const p = await payment(o, 'txn-2');
    await expect(ticket(reservationIds[1]!, o, p.id, seatIds[1]!, 'USED')).rejects.toThrow();
  });

  it('keeps order_id and payment_started_at of a reservation optional', async () => {
    const row = await ctx.db
      .selectFrom('reservations')
      .select(['order_id', 'payment_started_at'])
      .where('id', '=', reservationIds[0]!)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ order_id: null, payment_started_at: null });
  });

  it('deletes orders, payments and tickets in cascade with their event', async () => {
    const o = await order();
    const p = await payment(o, 'txn-1');
    await ticket(reservationIds[0]!, o, p.id, seatIds[0]!);
    await ctx.db.deleteFrom('events').execute();
    expect(await ctx.db.selectFrom('tickets').selectAll().execute()).toHaveLength(0);
    expect(await ctx.db.selectFrom('payments').selectAll().execute()).toHaveLength(0);
    expect(await ctx.db.selectFrom('orders').selectAll().execute()).toHaveLength(0);
  });

  it('sets reservations.order_id to null when the order disappears', async () => {
    const o = await order();
    await ctx.db
      .updateTable('reservations')
      .set({ order_id: o })
      .where('id', '=', reservationIds[0]!)
      .execute();
    await ctx.db.deleteFrom('orders').where('id', '=', o).execute();
    const row = await ctx.db
      .selectFrom('reservations')
      .select('order_id')
      .where('id', '=', reservationIds[0]!)
      .executeTakeFirstOrThrow();
    expect(row.order_id).toBeNull();
  });
});
