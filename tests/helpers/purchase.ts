import request from 'supertest';
import type { Express } from 'express';
import type { Db } from '../../src/db/database.js';
import { bearer, createUserAndLogin } from './auth.js';
import { insertEventWithSeats } from './events.js';

export const CARD = { brand: 'VISA', number: '4111111111111111', expiry: '12/28', cvv: '123' };

export function purchaseBody(reservationId: string, card: Record<string, unknown> = CARD) {
  return { reservationId, card };
}

/** Un USER con una reserva ACTIVE de un seat de un evento con seats. */
export async function reserveSeat(
  app: Express,
  db: Db,
  options: { email?: string; seat?: string; eventId?: string; price?: number } = {},
) {
  const { token } = await createUserAndLogin(app, db, 'USER', options.email ?? 'buyer@mail.com');
  const eventId =
    options.eventId ??
    (await insertEventWithSeats(db, { capacity: 20, price: options.price ?? 150000 })).id;
  const res = await request(app)
    .post('/reservations')
    .set(...bearer(token))
    .send({ eventId, seats: [options.seat ?? 'A1'] });
  return {
    token,
    eventId,
    // POST /reservations responde un lote: aquí siempre se reserva un seat
    reservation: (res.body.reservations as { id: string; seatId: string; amount: number }[])[0]!,
  };
}

/** Inserta directamente (sin pasarela) una reserva CONFIRMED, su pago y su ticket. */
export async function insertTicket(
  db: Db,
  input: { userId: string; eventId: string; seatId: string; issuedAt?: Date; status?: string },
) {
  const reservation = await db
    .insertInto('reservations')
    .values({
      user_id: input.userId,
      seat_id: input.seatId,
      event_id: input.eventId,
      amount: 100,
      status: 'CONFIRMED',
      expires_at: new Date(Date.now() + 600_000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const payment = await db
    .insertInto('payments')
    .values({
      reservation_id: reservation.id,
      user_id: input.userId,
      event_id: input.eventId,
      transaction_id: `txn-${crypto.randomUUID()}`,
      amount: 100,
      status: input.status === 'CANCELLED_BY_EVENT' ? 'REFUND_PENDING' : 'APPROVED',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db.updateTable('seats').set({ status: 'SOLD' }).where('id', '=', input.seatId).execute();
  return db
    .insertInto('tickets')
    .values({
      reservation_id: reservation.id,
      payment_id: payment.id,
      user_id: input.userId,
      event_id: input.eventId,
      seat_id: input.seatId,
      amount: 100,
      status: input.status ?? 'ISSUED',
      issued_at: input.issuedAt ?? new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}
