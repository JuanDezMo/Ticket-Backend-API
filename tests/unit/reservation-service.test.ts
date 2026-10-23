import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/database.js';
import type { Event } from '../../src/modules/events/event.types.js';
import { ReservationService } from '../../src/modules/reservations/reservation.service.js';
import type { ReservationRepository } from '../../src/modules/reservations/reservation.repository.js';
import type { Seat } from '../../src/modules/seats/seat.types.js';
import { AppError } from '../../src/shared/errors/index.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const event: Event = {
  id: 'event-1',
  name: 'Rock',
  description: 'd',
  type: 'CONCERT',
  venue: 'v',
  price: 150000,
  capacity: 20,
  maxSeatsPerUser: 4,
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

type Found = { reservation: Omit<typeof stored, 'status'> & { status: string }; expired: boolean };

function setup(
  overrides: {
    event?: Event;
    seat?: Seat | null;
    reserved?: boolean;
    found?: Found | null;
    seatById?: Seat | null;
    locked?: Found['reservation'] | null;
    cancelled?: boolean;
  } = {},
) {
  const events = {
    getById: vi.fn().mockResolvedValue(overrides.event ?? event),
    findForShare: vi.fn().mockResolvedValue(overrides.event ?? event),
  };
  const seats = {
    findByEventAndLabel: vi
      .fn()
      .mockResolvedValue(overrides.seat === undefined ? seat : overrides.seat),
    markReserved: vi.fn().mockResolvedValue(overrides.reserved ?? true),
    releaseReserved: vi.fn().mockResolvedValue(true),
    findById: vi
      .fn()
      .mockResolvedValue(overrides.seatById === undefined ? seat : overrides.seatById),
  };
  const repo = {
    releaseExpired: vi.fn().mockResolvedValue(0),
    cancelActiveByEvent: vi.fn().mockResolvedValue(0),
    findForPurchase: vi.fn().mockResolvedValue(overrides.found ?? null),
    lockById: vi.fn().mockResolvedValue(overrides.locked === undefined ? null : overrides.locked),
    markConfirmed: vi.fn().mockResolvedValue(true),
    markCancelledByUser: vi.fn().mockResolvedValue(overrides.cancelled ?? true),
    create: vi.fn().mockResolvedValue(stored),
  } satisfies ReservationRepository;
  const trx = {};
  const transaction = vi.fn(() => ({ execute: (cb: (t: unknown) => unknown) => cb(trx) }));
  const db = { transaction };
  const service = new ReservationService(
    repo,
    seats as never,
    events as never,
    db as unknown as Db,
    10,
    () => NOW,
  );
  return { service, events, seats, repo, trx, transaction };
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

describe('ReservationService.getForOwner', () => {
  const found = (status: string, expired = false) => ({
    reservation: { ...stored, status },
    expired,
  });

  const expectNoWrites = ({ repo, seats }: ReturnType<typeof setup>) => {
    expect(repo.releaseExpired).not.toHaveBeenCalled();
    expect(repo.markConfirmed).not.toHaveBeenCalled();
    expect(seats.markReserved).not.toHaveBeenCalled();
  };

  it('returns an ACTIVE reservation that has not expired, with the seat label', async () => {
    const ctx = setup({ found: found('ACTIVE') });
    const result = await ctx.service.getForOwner('user-1', 'res-1');
    expect(result).toEqual({
      id: 'res-1',
      eventId: 'event-1',
      seatId: 'seat-1',
      seat: 'C7',
      status: 'ACTIVE',
      amount: 150000,
      expiresAt: stored.expiresAt.toISOString(),
      createdAt: NOW.toISOString(),
    });
    expect(ctx.seats.findById).toHaveBeenCalledWith('seat-1');
    expectNoWrites(ctx);
  });

  it('reports an expired ACTIVE reservation as EXPIRED without writing', async () => {
    const ctx = setup({ found: found('ACTIVE', true) });
    expect((await ctx.service.getForOwner('user-1', 'res-1')).status).toBe('EXPIRED');
    expectNoWrites(ctx);
  });

  it('keeps CONFIRMED even when expires_at has passed', async () => {
    const ctx = setup({ found: found('CONFIRMED', true) });
    expect((await ctx.service.getForOwner('user-1', 'res-1')).status).toBe('CONFIRMED');
    expectNoWrites(ctx);
  });

  it('returns CANCELLED as stored', async () => {
    const ctx = setup({ found: found('CANCELLED') });
    expect((await ctx.service.getForOwner('user-1', 'res-1')).status).toBe('CANCELLED');
    expectNoWrites(ctx);
  });

  it('rejects another user with FORBIDDEN before reading the seat', async () => {
    const ctx = setup({ found: found('ACTIVE') });
    await expect(ctx.service.getForOwner('user-2', 'res-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(ctx.seats.findById).not.toHaveBeenCalled();
    expectNoWrites(ctx);
  });

  it('rejects an unknown reservation with RESERVATION_NOT_FOUND', async () => {
    const ctx = setup({ found: null });
    await expect(ctx.service.getForOwner('user-1', 'res-1')).rejects.toMatchObject({
      code: 'RESERVATION_NOT_FOUND',
    });
    expectNoWrites(ctx);
  });

  it('fails with an unexpected (logged) error when the seat does not exist', async () => {
    const ctx = setup({ found: found('ACTIVE'), seatById: null });
    const error = await ctx.service.getForOwner('user-1', 'res-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
    expect((error as Error).message).toBe('Seat seat-1 not found for reservation res-1');
    expectNoWrites(ctx);
  });
});

describe('ReservationService.cancelByOwner', () => {
  const active = { ...stored, status: 'ACTIVE' };
  const cancelSetup = (status = 'ACTIVE', extra: Parameters<typeof setup>[0] = {}) =>
    setup({
      found: { reservation: active, expired: false },
      locked: { ...stored, status },
      ...extra,
    });

  it('cancels an ACTIVE reservation, releases the seat and returns CANCELLED_BY_USER', async () => {
    const { service, repo, seats, trx } = cancelSetup();
    const result = await service.cancelByOwner('user-1', 'res-1');
    expect(result).toMatchObject({ id: 'res-1', seat: 'C7', status: 'CANCELLED_BY_USER' });
    expect(repo.markCancelledByUser).toHaveBeenCalledWith('res-1', trx);
    expect(seats.releaseReserved).toHaveBeenCalledWith('seat-1', trx);
  });

  it('locks the event before the reservation, inside the transaction', async () => {
    const { service, events, repo, trx } = cancelSetup();
    await service.cancelByOwner('user-1', 'res-1');
    expect(events.findForShare).toHaveBeenCalledWith('event-1', trx);
    expect(repo.lockById).toHaveBeenCalledWith('res-1', trx);
    expect(events.findForShare.mock.invocationCallOrder[0]).toBeLessThan(
      repo.lockById.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ['CANCELLED_BY_USER', 'RESERVATION_ALREADY_CANCELLED'],
    ['CONFIRMED', 'RESERVATION_ALREADY_CONFIRMED'],
    ['CANCELLED', 'EVENT_CANCELLED'],
    ['EXPIRED', 'RESERVATION_EXPIRED'],
  ])('rejects a %s reservation with %s without releasing the seat', async (status, code) => {
    const { service, repo, seats } = cancelSetup(status);
    await expect(service.cancelByOwner('user-1', 'res-1')).rejects.toMatchObject({ code });
    expect(repo.markCancelledByUser).not.toHaveBeenCalled();
    expect(seats.releaseReserved).not.toHaveBeenCalled();
  });

  it('rejects with EVENT_CANCELLED when the event is no longer ACTIVE', async () => {
    const { service, seats } = cancelSetup('ACTIVE', { event: { ...event, status: 'CANCELLED' } });
    await expect(service.cancelByOwner('user-1', 'res-1')).rejects.toMatchObject({
      code: 'EVENT_CANCELLED',
    });
    expect(seats.releaseReserved).not.toHaveBeenCalled();
  });

  it('rejects with RESERVATION_EXPIRED when the database clock says it expired', async () => {
    const { service, seats } = cancelSetup('ACTIVE', { cancelled: false });
    await expect(service.cancelByOwner('user-1', 'res-1')).rejects.toMatchObject({
      code: 'RESERVATION_EXPIRED',
    });
    expect(seats.releaseReserved).not.toHaveBeenCalled();
  });

  it('rejects another user with FORBIDDEN without opening the transaction', async () => {
    const { service, transaction, seats } = cancelSetup();
    await expect(service.cancelByOwner('user-2', 'res-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(seats.releaseReserved).not.toHaveBeenCalled();
  });

  it('rejects an unknown reservation with RESERVATION_NOT_FOUND', async () => {
    const { service, transaction } = setup({ found: null });
    await expect(service.cancelByOwner('user-1', 'res-1')).rejects.toMatchObject({
      code: 'RESERVATION_NOT_FOUND',
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
