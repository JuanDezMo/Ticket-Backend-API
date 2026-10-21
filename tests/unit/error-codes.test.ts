import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/shared/errors/index.js';

describe('reservation error codes', () => {
  it.each([
    ['SEAT_NOT_FOUND', 404, 'Seat not found'],
    ['SEAT_NOT_AVAILABLE', 409, 'Seat is not available'],
    ['EVENT_NOT_ACTIVE', 409, 'Event is not active or has already started'],
  ] as const)('%s maps to HTTP %i with an English message', (code, status, message) => {
    const error = new AppError(code);
    expect(error.status).toBe(status);
    expect(error.message).toBe(message);
  });
});
