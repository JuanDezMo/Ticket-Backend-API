import { describe, expect, it } from 'vitest';
import { parseCardBrand } from '../../src/modules/payments/card-brand.js';

const expectError = (value: unknown, code: string) => {
  try {
    parseCardBrand(value);
    expect.unreachable();
  } catch (error) {
    expect(error).toMatchObject({ code, status: 400 });
  }
};

describe('parseCardBrand', () => {
  it.each(['VISA', 'MASTERCARD', 'AMEX'])('accepts %s', (brand) => {
    expect(parseCardBrand(brand)).toBe(brand);
  });

  it.each([
    ['visa', 'VISA'],
    ['Visa', 'VISA'],
    [' mastercard ', 'MASTERCARD'],
    ['amex', 'AMEX'],
  ])('accepts %j in any case and returns %s', (input, expected) => {
    expect(parseCardBrand(input)).toBe(expected);
  });

  it.each([undefined, null, '', '   '])('answers CARD_BRAND_REQUIRED for %j', (value) => {
    expectError(value, 'CARD_BRAND_REQUIRED');
  });

  it.each(['DINERS', 'DISCOVER', 'VISA1', 'master card', 123, true, {}])(
    'answers CARD_BRAND_NOT_ALLOWED for %j',
    (value) => {
      expectError(value, 'CARD_BRAND_NOT_ALLOWED');
    },
  );

  it('uses the exact messages of the contract', () => {
    expect(() => parseCardBrand(undefined)).toThrow(
      'Card brand is required. Use VISA, MASTERCARD or AMEX',
    );
    expect(() => parseCardBrand('DINERS')).toThrow(
      'Card brand not allowed. Use VISA, MASTERCARD or AMEX',
    );
  });
});
