import type { Db } from '../../src/db/database.js';

const DAY = 24 * 3600 * 1000;

export function futureDate(daysAhead: number, hours = 20): string {
  const date = new Date(Date.now() + daysAhead * DAY);
  date.setUTCHours(hours, 0, 0, 0);
  return date.toISOString();
}

/** Cuerpo válido para POST /events. */
export function eventBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Rock Night',
    description: 'A great concert',
    type: 'CONCERT',
    venue: 'Main Hall',
    price: 150000,
    capacity: 20,
    maxSeatsPerUser: 4,
    startDate: futureDate(30),
    endDate: futureDate(30, 23),
    ...overrides,
  };
}

/** Inserta un evento directamente en la BD (permite fechas pasadas y estados distintos). */
export async function insertEvent(
  db: Db,
  overrides: Partial<{
    name: string;
    type: string;
    status: string;
    capacity: number;
    max_seats_per_user: number;
    price: number;
    start_date: string;
    end_date: string;
  }> = {},
) {
  return db
    .insertInto('events')
    .values({
      name: 'Event',
      description: 'desc',
      type: 'CONCERT',
      venue: 'Venue',
      price: 100,
      capacity: 10,
      max_seats_per_user: Math.min(4, overrides.capacity ?? 10),
      start_date: futureDate(10),
      end_date: futureDate(10, 23),
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Evento con sus seats ya generados (fila A..; 10 por fila). */
export async function insertEventWithSeats(
  db: Db,
  overrides: Parameters<typeof insertEvent>[1] & { price?: number } = {},
) {
  const { generateSeatLayout } = await import('../../src/modules/seats/seat-layout.js');
  const event = await insertEvent(db, overrides);
  const layout = generateSeatLayout(event.capacity);
  await db
    .insertInto('seats')
    .values(layout.map((p) => ({ event_id: event.id, row: p.row, number: p.number })))
    .execute();
  return event;
}

export async function seatOf(db: Db, eventId: string, row: string, number: number) {
  return db
    .selectFrom('seats')
    .selectAll()
    .where('event_id', '=', eventId)
    .where('row', '=', row)
    .where('number', '=', number)
    .executeTakeFirstOrThrow();
}

/** Fuerza el vencimiento de las reservas ACTIVE de un seat (o de todas). */
export async function expireReservations(db: Db, seatId?: string) {
  await db
    .updateTable('reservations')
    .set({ expires_at: new Date(Date.now() - 60_000) })
    .where('status', '=', 'ACTIVE')
    .$if(seatId !== undefined, (qb) => qb.where('seat_id', '=', seatId as string))
    .execute();
}

/** Crea una reserva directamente en la BD (y deja el seat en el estado indicado). */
export async function insertReservation(
  db: Db,
  input: {
    userId: string;
    eventId: string;
    seatId: string;
    status?: string;
    expired?: boolean;
    seatStatus?: string;
  },
) {
  await db
    .updateTable('seats')
    .set({ status: input.seatStatus ?? 'RESERVED' })
    .where('id', '=', input.seatId)
    .execute();
  return db
    .insertInto('reservations')
    .values({
      user_id: input.userId,
      seat_id: input.seatId,
      event_id: input.eventId,
      amount: 100,
      status: input.status ?? 'ACTIVE',
      expires_at: new Date(Date.now() + (input.expired ? -60_000 : 600_000)),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
