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
      start_date: futureDate(10),
      end_date: futureDate(10, 23),
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
