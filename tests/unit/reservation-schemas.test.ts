import { describe, expect, it } from 'vitest';
import {
  createReservationSchema,
  reservationIdParamsSchema,
} from '../../src/modules/reservations/reservation.schemas.js';

const eventId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('createReservationSchema', () => {
  it('accepts eventId and seat', () => {
    expect(createReservationSchema.parse({ eventId, seat: 'C7' })).toEqual({ eventId, seat: 'C7' });
  });

  it('normalizes a lowercase label to uppercase', () => {
    expect(createReservationSchema.parse({ eventId, seat: 'c7' }).seat).toBe('C7');
  });

  it.each([
    ['a missing eventId', { seat: 'C7' }],
    ['a missing seat', { eventId }],
    ['an invalid eventId', { eventId: 'abc', seat: 'C7' }],
    ['a label like 7C', { eventId, seat: '7C' }],
    ['a label like C11', { eventId, seat: 'C11' }],
    ['a label like C0', { eventId, seat: 'C0' }],
    ['an empty label', { eventId, seat: '' }],
    ['a client-sent amount', { eventId, seat: 'C7', amount: 1 }],
    ['an old-style seatId', { eventId, seat: 'C7', seatId: eventId }],
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
