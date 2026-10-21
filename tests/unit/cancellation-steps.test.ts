import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { BlockSeatsStep } from '../../src/modules/cancellations/steps/block-seats.step.js';
import { CancelReservationsStep } from '../../src/modules/cancellations/steps/cancel-reservations.step.js';

const trx = {} as Db;

describe('cancellation steps', () => {
  it('BlockSeatsStep delegates to SeatService with the transaction and returns the count', async () => {
    const seats = { blockAllByEvent: vi.fn().mockResolvedValue(25) };
    const step = new BlockSeatsStep(seats as never);
    expect(step.name).toBe('seats');
    expect(await step.execute('event-1', trx)).toBe(25);
    expect(seats.blockAllByEvent).toHaveBeenCalledWith('event-1', trx);
  });

  it('CancelReservationsStep delegates to ReservationService with the transaction', async () => {
    const reservations = { cancelActiveByEvent: vi.fn().mockResolvedValue(3) };
    const step = new CancelReservationsStep(reservations as never);
    expect(step.name).toBe('reservations');
    expect(await step.execute('event-1', trx)).toBe(3);
    expect(reservations.cancelActiveByEvent).toHaveBeenCalledWith('event-1', trx);
  });
});
