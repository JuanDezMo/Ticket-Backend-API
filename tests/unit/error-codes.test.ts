import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/shared/errors/index.js';

describe('reservation and cancellation error codes', () => {
  it.each([
    ['SEAT_NOT_FOUND', 404, 'Seat not found'],
    ['SEAT_NOT_AVAILABLE', 409, 'Seat is not available'],
    ['EVENT_NOT_ACTIVE', 409, 'Event is not active or has already started'],
    ['EVENT_ALREADY_CANCELLED', 409, 'Event is already cancelled'],
    ['CARD_BRAND_REQUIRED', 400, 'Card brand is required. Use VISA, MASTERCARD or AMEX'],
    ['CARD_BRAND_NOT_ALLOWED', 400, 'Card brand not allowed. Use VISA, MASTERCARD or AMEX'],
    ['RESERVATION_NOT_FOUND', 404, 'Reservation not found'],
    ['RESERVATION_EXPIRED', 409, 'Reservation has expired or is no longer active'],
    ['RESERVATION_ALREADY_CANCELLED', 409, 'Reservation has already been cancelled'],
    ['RESERVATION_ALREADY_CONFIRMED', 409, 'Reservation has already been paid'],
    ['EVENT_CANCELLED', 409, 'Event has been cancelled'],
    ['PAYMENT_REJECTED', 402, 'Payment was rejected. Try another card'],
    ['CARD_PROBLEM', 422, 'The card has problems, use another payment method'],
    ['PAYMENT_GATEWAY_ERROR', 502, 'Payment service error, please try again'],
    ['PAYMENT_GATEWAY_TIMEOUT', 504, 'Payment service timed out, please try again'],
    ['EVENT_ALREADY_ENDED', 409, 'Event has already ended'],
  ] as const)('%s maps to HTTP %i with an English message', (code, status, message) => {
    const error = new AppError(code);
    expect(error.status).toBe(status);
    expect(error.message).toBe(message);
  });
});
