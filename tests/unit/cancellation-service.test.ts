import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/database.js';
import type { CancellationStep } from '../../src/modules/cancellations/cancellation-step.js';
import { CancellationService } from '../../src/modules/cancellations/cancellation.service.js';
import type { Event } from '../../src/modules/events/event.types.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const baseEvent: Event = {
  id: 'event-1',
  name: 'Rock',
  description: 'd',
  type: 'CONCERT',
  venue: 'v',
  price: 100,
  capacity: 20,
  maxSeatsPerUser: 4,
  startDate: new Date('2026-07-01T20:00:00Z'),
  endDate: new Date('2026-07-01T23:00:00Z'),
  status: 'ACTIVE',
  createdAt: NOW,
};

function setup(event: Event = baseEvent, markCancelled = true) {
  const calls: string[] = [];
  const events = {
    getById: vi.fn().mockResolvedValue(event),
    markCancelled: vi.fn().mockImplementation(async () => {
      calls.push('event');
      return markCancelled;
    }),
  };
  const step = (name: CancellationStep['name'], count: number): CancellationStep => ({
    name,
    execute: vi.fn().mockImplementation(async () => {
      calls.push(name);
      return count;
    }),
  });
  const trx = {};
  const db = { transaction: () => ({ execute: (cb: (t: unknown) => unknown) => cb(trx) }) };
  const build = (steps: CancellationStep[]) =>
    new CancellationService(events as never, steps, db as unknown as Db, () => NOW);
  return { build, events, calls, step, trx };
}

describe('CancellationService.cancel', () => {
  it('marks the event first, then runs the steps in the registered order', async () => {
    const { build, calls, step } = setup();
    const service = build([step('seats', 20), step('reservations', 3)]);
    await service.cancel('event-1');
    expect(calls).toEqual(['event', 'seats', 'reservations']);
  });

  it('passes the transaction to every step', async () => {
    const { build, step, trx } = setup();
    const seats = step('seats', 1);
    await build([seats]).cancel('event-1');
    expect(seats.execute).toHaveBeenCalledWith('event-1', trx);
  });

  it('takes cancelledReservations from the reservations step and defaults cancelledTickets to 0', async () => {
    const { build, step } = setup();
    const result = await build([step('seats', 20), step('reservations', 3)]).cancel('event-1');
    expect(result).toEqual({
      id: 'event-1',
      status: 'CANCELLED',
      cancelledReservations: 3,
      cancelledTickets: 0,
    });
  });

  it('reflects an extra "tickets" step without changing the service', async () => {
    const { build, step } = setup();
    const result = await build([
      step('seats', 20),
      step('reservations', 3),
      step('tickets', 12),
    ]).cancel('event-1');
    expect(result.cancelledTickets).toBe(12);
    expect(result.cancelledReservations).toBe(3);
  });

  it('answers EVENT_ALREADY_CANCELLED for a cancelled event without running anything', async () => {
    const { build, step, events } = setup({ ...baseEvent, status: 'CANCELLED' });
    const seats = step('seats', 1);
    await expect(build([seats]).cancel('event-1')).rejects.toMatchObject({
      code: 'EVENT_ALREADY_CANCELLED',
    });
    expect(events.markCancelled).not.toHaveBeenCalled();
    expect(seats.execute).not.toHaveBeenCalled();
  });

  it('answers EVENT_ALREADY_ENDED when endDate has passed', async () => {
    const { build, step } = setup({ ...baseEvent, endDate: new Date('2026-05-01T00:00:00Z') });
    await expect(build([step('seats', 1)]).cancel('event-1')).rejects.toMatchObject({
      code: 'EVENT_ALREADY_ENDED',
      status: 409,
    });
  });

  it('reports EVENT_ALREADY_CANCELLED before EVENT_ALREADY_ENDED', async () => {
    const { build, step } = setup({
      ...baseEvent,
      status: 'CANCELLED',
      endDate: new Date('2026-05-01T00:00:00Z'),
    });
    await expect(build([step('seats', 1)]).cancel('event-1')).rejects.toMatchObject({
      code: 'EVENT_ALREADY_CANCELLED',
    });
  });

  it('cancels an event that already started but has not ended', async () => {
    const { build, step } = setup({
      ...baseEvent,
      startDate: new Date('2026-05-30T00:00:00Z'),
      endDate: new Date('2026-06-02T00:00:00Z'),
    });
    await expect(build([step('seats', 1)]).cancel('event-1')).resolves.toMatchObject({
      status: 'CANCELLED',
    });
  });

  it('answers EVENT_ALREADY_CANCELLED and skips the steps when another request won the race', async () => {
    const { build, step } = setup(baseEvent, false);
    const seats = step('seats', 1);
    await expect(build([seats]).cancel('event-1')).rejects.toMatchObject({
      code: 'EVENT_ALREADY_CANCELLED',
    });
    expect(seats.execute).not.toHaveBeenCalled();
  });

  it('propagates a step failure (the transaction is rolled back)', async () => {
    const { build, step } = setup();
    const failing: CancellationStep = {
      name: 'reservations',
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    };
    await expect(build([step('seats', 1), failing]).cancel('event-1')).rejects.toThrow('boom');
  });
});
