import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { AppError } from '../../src/shared/errors/index.js';
import type { Logger } from '../../src/shared/logger.js';
import { TicketService } from '../../src/modules/tickets/ticket.service.js';
import type { Ticket } from '../../src/modules/tickets/ticket.types.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const reservation = {
  id: 'res-1',
  userId: 'user-1',
  seatId: 'seat-1',
  eventId: 'event-1',
  amount: 150000,
  status: 'ACTIVE' as const,
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 600_000),
};
const event = { id: 'event-1', status: 'ACTIVE' as const };
const ticket: Ticket = {
  id: 'ticket-1',
  reservationId: 'res-1',
  paymentId: 'pay-1',
  userId: 'user-1',
  eventId: 'event-1',
  seatId: 'seat-1',
  amount: 150000,
  status: 'ISSUED',
  issuedAt: NOW,
  seat: 'C7',
  transactionId: 'txn-1',
};
const MISSING = Symbol('missing');
const body = (brand: unknown = 'VISA') => ({
  reservationId: 'res-1',
  card: {
    ...(brand === MISSING ? {} : { brand }),
    number: '4111111111111111',
    expiry: '12/28',
    cvv: '123',
  },
});

function setup(
  overrides: {
    expired?: boolean;
    reservation?: object | null;
    event?: object;
    locked?: object | null;
    existing?: Ticket | null;
  } = {},
) {
  const trx = { trx: true } as unknown as Db;
  const db = {
    transaction: () => ({ execute: (cb: (t: Db) => unknown) => cb(trx) }),
  } as unknown as Db;
  const reservations = {
    findForPurchase: vi.fn().mockResolvedValue(
      overrides.reservation === null
        ? null
        : {
            reservation: { ...reservation, ...overrides.reservation },
            expired: overrides.expired ?? false,
          },
    ),
    lockById: vi
      .fn()
      .mockResolvedValue(overrides.locked === undefined ? { ...reservation } : overrides.locked),
    markConfirmed: vi.fn().mockResolvedValue(true),
  };
  const events = {
    getById: vi.fn().mockResolvedValue({ ...event, ...overrides.event }),
    findForShare: vi.fn().mockResolvedValue({ ...event, ...overrides.event }),
  };
  const seats = { markSold: vi.fn().mockResolvedValue(true) };
  const payments = {
    charge: vi.fn().mockResolvedValue({ transactionId: 'txn-1' }),
    recordApproved: vi.fn().mockResolvedValue({ id: 'pay-1' }),
    recordRefundPending: vi.fn().mockResolvedValue({ id: 'pay-1' }),
    markRefundPending: vi.fn().mockResolvedValue(0),
  };
  const tickets = {
    findByReservation: vi.fn().mockResolvedValue(overrides.existing ?? null),
    create: vi.fn().mockResolvedValue({ id: 'ticket-1' }),
    listByUser: vi.fn(),
    cancelByEvent: vi.fn().mockResolvedValue(['pay-1', 'pay-2']),
  };
  // El ticket aparece recién después de crearse
  tickets.findByReservation.mockImplementation(
    async (_id: string, executor?: Db) =>
      overrides.existing ?? (executor && tickets.create.mock.calls.length > 0 ? ticket : null),
  );
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Logger & {
    error: ReturnType<typeof vi.fn>;
  };
  const service = new TicketService(
    tickets as never,
    reservations as never,
    events as never,
    seats as never,
    payments as never,
    db,
    logger,
  );
  return { service, reservations, events, seats, payments, tickets, trx, logger };
}

describe('TicketService.purchase', () => {
  it('issues the ticket with the reservation amount and returns created = true', async () => {
    const { service, payments, tickets, seats, reservations, trx } = setup();
    const result = await service.purchase('user-1', body('visa'));

    expect(result.created).toBe(true);
    expect(result.ticket).toMatchObject({
      id: 'ticket-1',
      status: 'ISSUED',
      seat: 'C7',
      amount: 150000,
      transactionId: 'txn-1',
    });
    expect(payments.charge).toHaveBeenCalledTimes(1);
    expect(payments.charge).toHaveBeenCalledWith({
      reservationId: 'res-1',
      amount: 150000,
      card: { brand: 'VISA', number: '4111111111111111', expiry: '12/28', cvv: '123' },
    });
    expect(reservations.markConfirmed).toHaveBeenCalledWith('res-1', trx);
    expect(seats.markSold).toHaveBeenCalledWith('seat-1', trx);
    expect(payments.recordApproved).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'txn-1' }),
      trx,
    );
    expect(tickets.create).toHaveBeenCalledOnce();
  });

  it.each([
    [MISSING, 'CARD_BRAND_REQUIRED'],
    [null, 'CARD_BRAND_REQUIRED'],
    ['', 'CARD_BRAND_REQUIRED'],
    ['DINERS', 'CARD_BRAND_NOT_ALLOWED'],
  ])(
    'validates the brand %j first, before touching the database or the gateway',
    async (brand, code) => {
      const { service, reservations, payments } = setup();
      await expect(service.purchase('user-1', body(brand))).rejects.toMatchObject({
        code,
        status: 400,
      });
      expect(reservations.findForPurchase).not.toHaveBeenCalled();
      expect(payments.charge).not.toHaveBeenCalled();
    },
  );

  it('answers RESERVATION_NOT_FOUND', async () => {
    const { service, payments } = setup({ reservation: null });
    await expect(service.purchase('user-1', body())).rejects.toMatchObject({
      code: 'RESERVATION_NOT_FOUND',
    });
    expect(payments.charge).not.toHaveBeenCalled();
  });

  it('answers FORBIDDEN for a reservation of another user without charging', async () => {
    const { service, payments } = setup();
    await expect(service.purchase('someone-else', body())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(payments.charge).not.toHaveBeenCalled();
  });

  it('returns the existing ticket (created = false) without charging again', async () => {
    const { service, payments } = setup({ existing: ticket });
    const result = await service.purchase('user-1', body());
    expect(result).toMatchObject({ created: false, ticket: { id: 'ticket-1' } });
    expect(payments.charge).not.toHaveBeenCalled();
  });

  it('checks the event before the reservation: a cancelled event answers EVENT_CANCELLED', async () => {
    const { service, payments } = setup({
      event: { status: 'CANCELLED' },
      reservation: { status: 'CANCELLED' },
    });
    await expect(service.purchase('user-1', body())).rejects.toMatchObject({
      code: 'EVENT_CANCELLED',
    });
    expect(payments.charge).not.toHaveBeenCalled();
  });

  it.each([
    ['expired by time', { expired: true }],
    ['EXPIRED status', { reservation: { status: 'EXPIRED' } }],
    ['CANCELLED status', { reservation: { status: 'CANCELLED' } }],
  ])('answers RESERVATION_EXPIRED for a reservation %s', async (_name, overrides) => {
    const { service, payments } = setup(overrides);
    await expect(service.purchase('user-1', body())).rejects.toMatchObject({
      code: 'RESERVATION_EXPIRED',
    });
    expect(payments.charge).not.toHaveBeenCalled();
  });

  it('answers RESERVATION_ALREADY_CANCELLED for a reservation cancelled by its owner, without charging', async () => {
    const { service, payments } = setup({ reservation: { status: 'CANCELLED_BY_USER' } });
    await expect(service.purchase('user-1', body())).rejects.toMatchObject({
      code: 'RESERVATION_ALREADY_CANCELLED',
    });
    expect(payments.charge).not.toHaveBeenCalled();
  });

  it('propagates a payment failure without touching the reservation, seat or tickets', async () => {
    const { service, payments, reservations, seats, tickets } = setup();
    payments.charge.mockRejectedValueOnce(new AppError('PAYMENT_REJECTED'));
    await expect(service.purchase('user-1', body())).rejects.toMatchObject({
      code: 'PAYMENT_REJECTED',
    });
    expect(reservations.markConfirmed).not.toHaveBeenCalled();
    expect(seats.markSold).not.toHaveBeenCalled();
    expect(tickets.create).not.toHaveBeenCalled();
    expect(payments.recordApproved).not.toHaveBeenCalled();
    expect(payments.recordRefundPending).not.toHaveBeenCalled();
  });

  it('returns the winner ticket when another request confirmed the reservation meanwhile', async () => {
    const { service, tickets, payments } = setup();
    tickets.findByReservation.mockResolvedValueOnce(null).mockResolvedValueOnce(ticket);
    // la reserva ya figura CONFIRMED cuando se bloquea dentro de la transacción
    const s = setup({ locked: { ...reservation, status: 'CONFIRMED' } });
    s.tickets.findByReservation.mockResolvedValueOnce(null).mockResolvedValueOnce(ticket);
    const result = await s.service.purchase('user-1', body());
    expect(result).toMatchObject({ created: false, ticket: { id: 'ticket-1' } });
    expect(s.tickets.create).not.toHaveBeenCalled();
    expect(s.payments.recordApproved).not.toHaveBeenCalled();
    void service;
    void payments;
  });

  it('records REFUND_PENDING and answers EVENT_CANCELLED when the event was cancelled during the payment', async () => {
    const { service, events, payments, tickets, trx } = setup();
    events.findForShare.mockResolvedValue({ ...event, status: 'CANCELLED' });
    await expect(service.purchase('user-1', body())).rejects.toMatchObject({
      code: 'EVENT_CANCELLED',
    });
    expect(payments.recordRefundPending).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'txn-1' }),
      trx,
    );
    expect(tickets.create).not.toHaveBeenCalled();
    expect(payments.recordApproved).not.toHaveBeenCalled();
  });

  it('records REFUND_PENDING and answers RESERVATION_EXPIRED when the reservation was released during the payment', async () => {
    const { service, payments, tickets } = setup({ locked: { ...reservation, status: 'EXPIRED' } });
    await expect(service.purchase('user-1', body())).rejects.toMatchObject({
      code: 'RESERVATION_EXPIRED',
    });
    expect(payments.recordRefundPending).toHaveBeenCalledOnce();
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('records REFUND_PENDING and answers RESERVATION_ALREADY_CANCELLED when the owner cancelled during the payment', async () => {
    const { service, payments, tickets, trx } = setup({
      locked: { ...reservation, status: 'CANCELLED_BY_USER' },
    });
    await expect(service.purchase('user-1', body())).rejects.toMatchObject({
      code: 'RESERVATION_ALREADY_CANCELLED',
    });
    expect(payments.recordRefundPending).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'txn-1' }),
      trx,
    );
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('records the charge as REFUND_PENDING (outside the failed transaction) and rethrows on an unexpected failure', async () => {
    const { service, seats, payments, trx } = setup();
    seats.markSold.mockResolvedValueOnce(false);
    await expect(service.purchase('user-1', body())).rejects.toThrow('state changed');
    expect(payments.recordRefundPending).toHaveBeenCalledOnce();
    expect(payments.recordRefundPending).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'txn-1' }),
    );
    expect(payments.recordRefundPending).not.toHaveBeenCalledWith(expect.anything(), trx);
  });

  it('logs for manual reconciliation (without card data) if even the refund record fails', async () => {
    const { service, seats, payments, logger } = setup();
    seats.markSold.mockResolvedValueOnce(false);
    payments.recordRefundPending.mockRejectedValueOnce(new Error('db down'));
    await expect(service.purchase('user-1', body())).rejects.toThrow('state changed');
    expect(logger.error).toHaveBeenCalledOnce();
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).toContain('txn-1');
    expect(logged).not.toContain('4111111111111111');
    expect(logged).not.toContain('123"');
  });
});

describe('TicketService.cancelByEvent', () => {
  it('cancels the tickets, marks their payments REFUND_PENDING and returns the count', async () => {
    const { service, tickets, payments, trx } = setup();
    expect(await service.cancelByEvent('event-1', trx)).toBe(2);
    expect(tickets.cancelByEvent).toHaveBeenCalledWith('event-1', trx);
    expect(payments.markRefundPending).toHaveBeenCalledWith(['pay-1', 'pay-2'], trx);
  });
});
