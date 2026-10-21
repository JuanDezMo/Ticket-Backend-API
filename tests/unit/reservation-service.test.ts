import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/database.js';
import type { Event } from '../../src/modules/events/event.types.js';
import { ReservationService } from '../../src/modules/reservations/reservation.service.js';
import type { ReservationRepository } from '../../src/modules/reservations/reservation.repository.js';
import type { Seat } from '../../src/modules/seats/seat.types.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const event: Event = {
  id: 'event-1',
  name: 'Rock',
  description: 'd',
  type: 'CONCERT',
  venue: 'v',
  price: 150000,
  capacity: 20,
  startDate: new Date('2026-07-01T20:00:00Z'),
  endDate: new Date('2026-07-01T23:00:00Z'),
  status: 'ACTIVE',
  createdAt: NOW,
};
const seat: Seat = { id: 'seat-1', eventId: 'event-1', row: 'C', number: 7, status: 'AVAILABLE' };
const stored = {
  id: 'res-1',
  userId: 'user-1',
  seatId: 'seat-1',
  eventId: 'event-1',
  amount: 150000,
  status: 'ACTIVE' as const,
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 600_000),
};

function setup(overrides: { event?: Event; seat?: Seat | null; reserved?: boolean } = {}) {
  const events = { getById: vi.fn().mockResolvedValue(overrides.event ?? event) };
  const seats = {
    findByEventAndLabel: vi
      .fn()
      .mockResolvedValue(overrides.seat === undefined ? seat : overrides.seat),
    markReserved: vi.fn().mockResolvedValue(overrides.reserved ?? true),
  };
  const repo = {
    releaseExpired: vi.fn().mockResolvedValue(0),
    cancelActiveByEvent: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue(stored),
  } satisfies ReservationRepository;
  const trx = {};
  const db = { transaction: () => ({ execute: (cb: (t: unknown) => unknown) => cb(trx) }) };
  const service = new ReservationService(
    repo,
    seats as never,
    events as never,
    db as unknown as Db,
    10,
    () => NOW,
  );
  return { service, events, seats, repo, trx };
}

describe('ReservationService.create', () => {
  it('reserves the seat using the event price and returns the label', async () => {
    const { service, repo, seats, trx } = setup();
    const result = await service.create('user-1', { eventId: 'event-1', seat: 'C7' });
    expect(result).toMatchObject({
      seat: 'C7',
      seatId: 'seat-1',
      amount: 150000,
      status: 'ACTIVE',
    });
    expect(repo.releaseExpired).toHaveBeenCalledWith('event-1', trx);
    expect(seats.markReserved).toHaveBeenCalledWith('seat-1', trx);
    expect(repo.create).toHaveBeenCalledWith(
      { userId: 'user-1', seatId: 'seat-1', eventId: 'event-1', amount: 150000 },
      10,
      trx,
    );
  });

  it('checks the event before the seat: a cancelled event answers EVENT_NOT_ACTIVE', async () => {
    const { service, seats } = setup({ event: { ...event, status: 'CANCELLED' }, reserved: false });
    await expect(service.create('u', { eventId: 'event-1', seat: 'C7' })).rejects.toMatchObject({
      code: 'EVENT_NOT_ACTIVE',
    });
    expect(seats.findByEventAndLabel).not.toHaveBeenCalled();
  });

  it('rejects an event that already started', async () => {
    const { service } = setup({ event: { ...event, startDate: new Date('2026-05-01T00:00:00Z') } });
    await expect(service.create('u', { eventId: 'event-1', seat: 'C7' })).rejects.toMatchObject({
      code: 'EVENT_NOT_ACTIVE',
    });
  });

  it('answers SEAT_NOT_FOUND when the label does not exist in the event', async () => {
    const { service, repo } = setup({ seat: null });
    await expect(service.create('u', { eventId: 'event-1', seat: 'C7' })).rejects.toMatchObject({
      code: 'SEAT_NOT_FOUND',
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('answers SEAT_NOT_AVAILABLE and creates nothing when the seat was not AVAILABLE', async () => {
    const { service, repo } = setup({ reserved: false });
    await expect(service.create('u', { eventId: 'event-1', seat: 'C7' })).rejects.toMatchObject({
      code: 'SEAT_NOT_AVAILABLE',
      status: 409,
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('translates a unique-index violation into SEAT_NOT_AVAILABLE', async () => {
    const { service, repo } = setup();
    repo.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(service.create('u', { eventId: 'event-1', seat: 'C7' })).rejects.toMatchObject({
      code: 'SEAT_NOT_AVAILABLE',
    });
  });
});
