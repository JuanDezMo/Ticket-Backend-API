import { describe, expect, it } from 'vitest';
import {
  createReservationSchema,
  reservationIdParamsSchema,
} from '../../src/modules/reservations/reservation.schemas.js';

const eventId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('createReservationSchema', () => {
  it('accepts eventId and a list with one seat', () => {
    expect(createReservationSchema.parse({ eventId, seats: ['C7'] })).toEqual({
      eventId,
      seats: ['C7'],
    });
  });

  it('normalizes lowercase labels to uppercase and trims them', () => {
    expect(createReservationSchema.parse({ eventId, seats: ['c7', ' d1 '] }).seats).toEqual([
      'C7',
      'D1',
    ]);
  });

  it('keeps the order requested', () => {
    expect(createReservationSchema.parse({ eventId, seats: ['C7', 'A1', 'B3'] }).seats).toEqual([
      'C7',
      'A1',
      'B3',
    ]);
  });

  describe('number of seats', () => {
    const labels = (count: number) =>
      Array.from({ length: count }, (_, i) => `A${i + 1}`).slice(0, 10);
    const eight = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];

    it.each([1, 8])('accepts %i seats', (count) => {
      expect(createReservationSchema.safeParse({ eventId, seats: labels(count) }).success).toBe(
        true,
      );
      expect(
        createReservationSchema.parse({ eventId, seats: eight.slice(0, count) }).seats,
      ).toHaveLength(count);
    });

    it('rejects 0 seats', () => {
      expect(createReservationSchema.safeParse({ eventId, seats: [] }).success).toBe(false);
    });

    it('rejects 9 seats', () => {
      expect(createReservationSchema.safeParse({ eventId, seats: [...eight, 'A9'] }).success).toBe(
        false,
      );
    });
  });

  it.each([
    ['a missing eventId', { seats: ['C7'] }],
    ['missing seats', { eventId }],
    ['seats that are not a list', { eventId, seats: 'C7' }],
    ['an invalid eventId', { eventId: 'abc', seats: ['C7'] }],
    ['a label like 7C', { eventId, seats: ['7C'] }],
    ['a label like C11', { eventId, seats: ['C11'] }],
    ['a label like C0', { eventId, seats: ['C0'] }],
    ['an empty label', { eventId, seats: [''] }],
    ['one invalid label among valid ones', { eventId, seats: ['C7', 'C11'] }],
    ['repeated labels', { eventId, seats: ['C7', 'C7'] }],
    ['repeated labels in different case', { eventId, seats: ['C5', 'c5'] }],
    ['the old single seat field', { eventId, seat: 'C7' }],
    ['the old field next to the new one', { eventId, seat: 'C7', seats: ['C7'] }],
    ['a client-sent amount', { eventId, seats: ['C7'], amount: 1 }],
    ['an old-style seatId', { eventId, seats: ['C7'], seatId: eventId }],
  ])('rejects %s', (_name, body) => {
    expect(createReservationSchema.safeParse(body).success).toBe(false);
  });
});

describe('reservationIdParamsSchema', () => {
  it('accepts a UUID', () => {
    expect(reservationIdParamsSchema.parse({ id: eventId })).toEqual({ id: eventId });
  });

  it.each(['abc', ''])('rejects %j', (id) => {
    expect(reservationIdParamsSchema.safeParse({ id }).success).toBe(false);
  });
});
