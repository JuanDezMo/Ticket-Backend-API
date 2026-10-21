import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../../src/shared/utils/db-errors.js';
import { createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats, insertReservation, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('payments and tickets schema', () => {
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

  const payment = (reservationId: string, transactionId: string, status = 'APPROVED') =>
    ctx.db
      .insertInto('payments')
      .values({
        reservation_id: reservationId,
        user_id: userId,
        event_id: eventId,
        transaction_id: transactionId,
        amount: 100,
        status,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  const ticket = (reservationId: string, paymentId: string, seatId: string, status = 'ISSUED') =>
    ctx.db
      .insertInto('tickets')
      .values({
        reservation_id: reservationId,
        payment_id: paymentId,
        user_id: userId,
        event_id: eventId,
        seat_id: seatId,
        amount: 100,
        status,
      })
      .execute();

  it('rejects a second payment for the same reservation and a repeated transaction id', async () => {
    await payment(reservationIds[0]!, 'txn-1');
    await expect(payment(reservationIds[0]!, 'txn-2')).rejects.toSatisfy(isUniqueViolation);
    await expect(payment(reservationIds[1]!, 'txn-1')).rejects.toSatisfy(isUniqueViolation);
  });

  it('rejects a second ticket for the same reservation or payment', async () => {
    const p = await payment(reservationIds[0]!, 'txn-1');
    await ticket(reservationIds[0]!, p.id, seatIds[0]!);
    await expect(ticket(reservationIds[0]!, p.id, seatIds[0]!)).rejects.toSatisfy(
      isUniqueViolation,
    );
    await expect(ticket(reservationIds[1]!, p.id, seatIds[1]!)).rejects.toSatisfy(
      isUniqueViolation,
    );
  });

  it('rejects invalid statuses', async () => {
    await expect(payment(reservationIds[0]!, 'txn-1', 'PAID')).rejects.toThrow();
    const p = await payment(reservationIds[1]!, 'txn-2');
    await expect(ticket(reservationIds[1]!, p.id, seatIds[1]!, 'USED')).rejects.toThrow();
  });

  it('deletes payments and tickets in cascade with their event', async () => {
    const p = await payment(reservationIds[0]!, 'txn-1');
    await ticket(reservationIds[0]!, p.id, seatIds[0]!);
    await ctx.db.deleteFrom('events').execute();
    expect(await ctx.db.selectFrom('tickets').selectAll().execute()).toHaveLength(0);
    expect(await ctx.db.selectFrom('payments').selectAll().execute()).toHaveLength(0);
  });
});
