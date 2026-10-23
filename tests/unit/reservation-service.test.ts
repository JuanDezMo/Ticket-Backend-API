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
    seats?: Seat[];
    lockedSeats?: Seat[];
    markedCount?: number;
    found?: Found | null;
    seatById?: Seat | null;
    locked?: Found['reservation'] | null;
    cancelled?: boolean;
    heldInEvent?: number;
    activeHolds?: number;
    maxActiveHolds?: number;
  } = {},
) {
  const events = {
    getById: vi.fn().mockResolvedValue(overrides.event ?? event),
    findForShare: vi.fn().mockResolvedValue(overrides.event ?? event),
  };
  const found = overrides.seats ?? [seat];
  const seats = {
    findByEventAndLabels: vi.fn().mockResolvedValue(found),
    lockByIds: vi.fn().mockResolvedValue(overrides.lockedSeats ?? found),
    markReservedMany: vi.fn().mockResolvedValue(overrides.markedCount ?? found.length),
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
    createMany: vi
      .fn()
      .mockImplementation(async (items: { seatId: string }[]) =>
        items.map((item, index) => ({ ...stored, id: `res-${index + 1}`, seatId: item.seatId })),
      ),
    findManyForPurchase: vi.fn().mockResolvedValue([]),
    lockManyByIds: vi.fn().mockResolvedValue([]),
    markConfirmedMany: vi.fn().mockResolvedValue(0),
    attachToOrder: vi.fn().mockResolvedValue(undefined),
    claimForPayment: vi.fn().mockResolvedValue(true),
    releaseClaim: vi.fn().mockResolvedValue(undefined),
    lockHoldsOf: vi.fn().mockResolvedValue(undefined),
    countHoldsForEvent: vi.fn().mockResolvedValue(overrides.heldInEvent ?? 0),
    countActiveHolds: vi.fn().mockResolvedValue(overrides.activeHolds ?? 0),
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
    overrides.maxActiveHolds ?? 8,
    () => NOW,
  );
  return { service, events, seats, repo, trx, transaction };
}

const seatOf = (number: number): Seat => ({
  id: `seat-${number}`,
  eventId: 'event-1',
  row: 'C',
  number,
  status: 'AVAILABLE',
});
const batch = (count: number) => Array.from({ length: count }, (_, i) => seatOf(i + 1));
const labelsOf = (seats: Seat[]) => seats.map((s) => `${s.row}${s.number}`);
const request = (seats: Seat[]) => ({ eventId: 'event-1', seats: labelsOf(seats) });

describe('ReservationService.create', () => {
  it('reserves the seat using the event price and returns the label', async () => {
    const { service, repo, seats, trx } = setup();
    const result = await service.create('user-1', { eventId: 'event-1', seats: ['C7'] });
    expect(result).toEqual([
      expect.objectContaining({ seat: 'C7', seatId: 'seat-1', amount: 150000, status: 'ACTIVE' }),
    ]);
    expect(repo.lockHoldsOf).toHaveBeenCalledWith('user-1', trx);
    expect(repo.releaseExpired).toHaveBeenCalledWith('event-1', trx);
    expect(seats.lockByIds).toHaveBeenCalledWith(['seat-1'], trx);
    expect(seats.markReservedMany).toHaveBeenCalledWith(['seat-1'], trx);
    expect(repo.createMany).toHaveBeenCalledWith(
      [{ userId: 'user-1', seatId: 'seat-1', eventId: 'event-1', amount: 150000 }],
      10,
      trx,
    );
  });

  it('takes the user lock before counting and counting before reserving', async () => {
    const { service, repo, seats } = setup();
    await service.create('user-1', { eventId: 'event-1', seats: ['C7'] });
    const order = (fn: { mock: { invocationCallOrder: number[] } }) =>
      fn.mock.invocationCallOrder[0]!;
    expect(order(repo.lockHoldsOf)).toBeLessThan(order(repo.countHoldsForEvent));
    expect(order(repo.countHoldsForEvent)).toBeLessThan(order(repo.countActiveHolds));
    expect(order(repo.countActiveHolds)).toBeLessThan(order(seats.lockByIds));
    expect(order(seats.markReservedMany)).toBeLessThan(order(repo.createMany));
  });

  it.each([1, 3, 8])('reserves a batch of %i seats in the requested order', async (size) => {
    const seats = batch(size);
    const { service, repo } = setup({
      seats: [...seats].reverse(),
      event: { ...event, maxSeatsPerUser: 8 },
    });
    const result = await service.create('user-1', request(seats));
    expect(result.map((r) => r.seat)).toEqual(labelsOf(seats));
    expect(repo.createMany).toHaveBeenCalledTimes(1);
  });

  it('checks the event before the seats: a cancelled event answers EVENT_NOT_ACTIVE', async () => {
    const { service, seats } = setup({ event: { ...event, status: 'CANCELLED' } });
    await expect(service.create('u', { eventId: 'event-1', seats: ['C7'] })).rejects.toMatchObject({
      code: 'EVENT_NOT_ACTIVE',
    });
    expect(seats.findByEventAndLabels).not.toHaveBeenCalled();
  });

  it('rejects an event that already started', async () => {
    const { service } = setup({ event: { ...event, startDate: new Date('2026-05-01T00:00:00Z') } });
    await expect(service.create('u', { eventId: 'event-1', seats: ['C7'] })).rejects.toMatchObject({
      code: 'EVENT_NOT_ACTIVE',
    });
  });

  it('answers SEAT_NOT_FOUND when any label does not exist and reserves nothing', async () => {
    const { service, repo, transaction } = setup({ seats: [seatOf(7)] });
    await expect(
      service.create('u', { eventId: 'event-1', seats: ['C7', 'C8'] }),
    ).rejects.toMatchObject({ code: 'SEAT_NOT_FOUND' });
    expect(transaction).not.toHaveBeenCalled();
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  describe('limit per event', () => {
    it.each([
      // [límite, ya tiene, pide, ¿pasa?]
      [1, 0, 1, true],
      [1, 1, 1, false],
      [8, 0, 8, true],
      [8, 7, 1, true],
      [8, 8, 1, false],
      [4, 3, 1, true],
      [4, 3, 2, false],
      [4, 4, 1, false],
    ])('limit %i with %i held and %i requested: allowed=%s', async (limit, held, asked, ok) => {
      const seats = batch(asked);
      const { service, repo } = setup({
        event: { ...event, maxSeatsPerUser: limit },
        seats,
        heldInEvent: held,
      });
      const call = service.create('u', request(seats));
      if (ok) {
        await expect(call).resolves.toHaveLength(asked);
      } else {
        await expect(call).rejects.toMatchObject({ code: 'SEAT_LIMIT_REACHED', status: 409 });
        expect(repo.createMany).not.toHaveBeenCalled();
      }
    });

    it('names the limit of the event in the message', async () => {
      const { service } = setup({ event: { ...event, maxSeatsPerUser: 3 }, heldInEvent: 3 });
      await expect(service.create('u', { eventId: 'event-1', seats: ['C7'] })).rejects.toThrow(
        'You can hold up to 3 seats for this event',
      );
    });
  });

  describe('global cap on active holds', () => {
    it.each([
      // [tope, ya tiene, pide, ¿pasa?]
      [1, 0, 1, true],
      [1, 1, 1, false],
      [8, 7, 1, true],
      [8, 8, 1, false],
      [3, 0, 4, false],
    ])('cap %i with %i active and %i requested: allowed=%s', async (cap, active, asked, ok) => {
      const seats = batch(asked);
      const { service } = setup({
        event: { ...event, maxSeatsPerUser: 8 },
        seats,
        maxActiveHolds: cap,
        activeHolds: active,
      });
      const call = service.create('u', request(seats));
      if (ok) await expect(call).resolves.toHaveLength(asked);
      else await expect(call).rejects.toMatchObject({ code: 'HOLD_LIMIT_REACHED', status: 409 });
    });
  });

  it('answers SEAT_LIMIT_REACHED before SEAT_NOT_AVAILABLE and HOLD_LIMIT_REACHED after the first', async () => {
    const taken = { ...seat, status: 'RESERVED' as const };
    const both = setup({ lockedSeats: [taken], heldInEvent: 4, activeHolds: 8 });
    await expect(
      both.service.create('u', { eventId: 'event-1', seats: ['C7'] }),
    ).rejects.toMatchObject({ code: 'SEAT_LIMIT_REACHED' });
    const holdOnly = setup({ lockedSeats: [taken], activeHolds: 8 });
    await expect(
      holdOnly.service.create('u', { eventId: 'event-1', seats: ['C7'] }),
    ).rejects.toMatchObject({ code: 'HOLD_LIMIT_REACHED' });
    expect(holdOnly.seats.lockByIds).not.toHaveBeenCalled();
  });

  it('answers SEAT_NOT_AVAILABLE naming the taken seats and reserves none', async () => {
    const seats = batch(3);
    const locked = [seats[0]!, { ...seats[1]!, status: 'SOLD' as const }, seats[2]!];
    const { service, seats: seatService, repo } = setup({ seats, lockedSeats: locked });
    await expect(service.create('u', request(seats))).rejects.toMatchObject({
      code: 'SEAT_NOT_AVAILABLE',
      status: 409,
      message: 'Seats not available: C2',
    });
    expect(seatService.markReservedMany).not.toHaveBeenCalled();
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it('answers SEAT_NOT_AVAILABLE when marking the seats changes fewer rows than requested', async () => {
    const { service, repo } = setup({ markedCount: 0 });
    await expect(service.create('u', { eventId: 'event-1', seats: ['C7'] })).rejects.toMatchObject({
      code: 'SEAT_NOT_AVAILABLE',
    });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it('translates a unique-index violation into SEAT_NOT_AVAILABLE', async () => {
    const { service, repo } = setup();
    repo.createMany.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(service.create('u', { eventId: 'event-1', seats: ['C7'] })).rejects.toMatchObject({
      code: 'SEAT_NOT_AVAILABLE',
    });
  });

  it('lets any other repository error through untouched', async () => {
    const { service, repo } = setup();
    repo.createMany.mockRejectedValueOnce(new Error('insert failed'));
    await expect(service.create('u', { eventId: 'event-1', seats: ['C7'] })).rejects.toThrow(
      'insert failed',
    );
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
    expect(seats.markReservedMany).not.toHaveBeenCalled();
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
