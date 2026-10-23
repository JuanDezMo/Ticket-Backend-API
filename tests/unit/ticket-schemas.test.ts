import { describe, expect, it } from 'vitest';
import { purchaseSchema } from '../../src/modules/tickets/ticket.schemas.js';

const reservationId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const reservationIds = [reservationId];
const card = { brand: 'VISA', number: '4111111111111111', expiry: '12/28', cvv: '123' };
const uuids = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `7c9e6679-7425-40de-944b-e07fc1f90a${String(i).padStart(2, '0')}`,
  );

const messages = (body: unknown) => {
  const result = purchaseSchema.safeParse(body);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('purchaseSchema', () => {
  it('accepts a complete body with one reservation', () => {
    expect(purchaseSchema.safeParse({ reservationIds, card }).success).toBe(true);
  });

  it.each([1, 8])('accepts %i different reservations', (count) => {
    expect(purchaseSchema.safeParse({ reservationIds: uuids(count), card }).success).toBe(true);
  });

  it.each([0, 9])('rejects %i reservations', (count) => {
    expect(purchaseSchema.safeParse({ reservationIds: uuids(count), card }).success).toBe(false);
  });

  it('rejects repeated reservation ids', () => {
    expect(
      purchaseSchema.safeParse({ reservationIds: [reservationId, reservationId], card }).success,
    ).toBe(false);
  });

  it('says reservationIds is required when it is missing, also with the old single field', () => {
    expect(messages({ card })).toContain('reservationIds: is required');
    expect(messages({ reservationId, card })).toContain('reservationIds: is required');
  });

  it('rejects the old single reservationId even next to the new field', () => {
    expect(purchaseSchema.safeParse({ reservationId, reservationIds, card }).success).toBe(false);
  });

  it('lets a missing or odd brand through, to be rejected later with the specific error', () => {
    const withoutBrand: Record<string, unknown> = { ...card };
    delete withoutBrand.brand;
    expect(purchaseSchema.safeParse({ reservationIds, card: withoutBrand }).success).toBe(true);
    expect(
      purchaseSchema.safeParse({ reservationIds, card: { ...card, brand: null } }).success,
    ).toBe(true);
    expect(
      purchaseSchema.safeParse({ reservationIds, card: { ...card, brand: 'DINERS' } }).success,
    ).toBe(true);
  });

  it.each([
    ['an invalid reservation id', { reservationIds: ['abc'], card }],
    ['reservationIds that is not a list', { reservationIds: reservationId, card }],
    ['a missing card', { reservationIds }],
    ['a missing number', { reservationIds, card: { ...card, number: undefined } }],
    ['a missing expiry', { reservationIds, card: { ...card, expiry: undefined } }],
    ['a missing cvv', { reservationIds, card: { ...card, cvv: undefined } }],
    ['an empty cvv', { reservationIds, card: { ...card, cvv: '  ' } }],
    ['a client-sent amount', { reservationIds, card, amount: 1 }],
    ['an unknown card field', { reservationIds, card: { ...card, holder: 'x' } }],
  ])('rejects %s', (_name, body) => {
    expect(purchaseSchema.safeParse(body).success).toBe(false);
  });
});
