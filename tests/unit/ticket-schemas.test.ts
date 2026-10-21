import { describe, expect, it } from 'vitest';
import { purchaseSchema } from '../../src/modules/tickets/ticket.schemas.js';

const reservationId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const card = { brand: 'VISA', number: '4111111111111111', expiry: '12/28', cvv: '123' };

describe('purchaseSchema', () => {
  it('accepts a complete body', () => {
    expect(purchaseSchema.safeParse({ reservationId, card }).success).toBe(true);
  });

  it('lets a missing or odd brand through, to be rejected later with the specific error', () => {
    const withoutBrand: Record<string, unknown> = { ...card };
    delete withoutBrand.brand;
    expect(purchaseSchema.safeParse({ reservationId, card: withoutBrand }).success).toBe(true);
    expect(
      purchaseSchema.safeParse({ reservationId, card: { ...card, brand: null } }).success,
    ).toBe(true);
    expect(
      purchaseSchema.safeParse({ reservationId, card: { ...card, brand: 'DINERS' } }).success,
    ).toBe(true);
  });

  it.each([
    ['a missing reservationId', { card }],
    ['an invalid reservationId', { reservationId: 'abc', card }],
    ['a missing card', { reservationId }],
    ['a missing number', { reservationId, card: { ...card, number: undefined } }],
    ['a missing expiry', { reservationId, card: { ...card, expiry: undefined } }],
    ['a missing cvv', { reservationId, card: { ...card, cvv: undefined } }],
    ['an empty cvv', { reservationId, card: { ...card, cvv: '  ' } }],
    ['a client-sent amount', { reservationId, card, amount: 1 }],
    ['an unknown card field', { reservationId, card: { ...card, holder: 'x' } }],
  ])('rejects %s', (_name, body) => {
    expect(purchaseSchema.safeParse(body).success).toBe(false);
  });
});
