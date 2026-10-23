import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { AppError } from '../../src/shared/errors/index.js';
import type { Logger } from '../../src/shared/logger.js';
import { gatewayIdFor, TicketService } from '../../src/modules/tickets/ticket.service.js';
import type { Ticket } from '../../src/modules/tickets/ticket.types.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';
const R3 = '33333333-3333-4333-8333-333333333333';
const reservationOf = (id: string, overrides: object = {}) => ({
  id,
  userId: 'user-1',
  seatId: `seat-${id.slice(0, 1)}`,
  eventId: 'event-1',
  amount: 150000,
  status: 'ACTIVE' as const,
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 600_000),
  ...overrides,
});
const ticketOf = (id: string): Ticket => ({
  id: `ticket-${id.slice(0, 1)}`,
  reservationId: id,
  orderId: 'order-1',
  paymentId: 'pay-1',
  userId: 'user-1',
  eventId: 'event-1',
  seatId: `seat-${id.slice(0, 1)}`,
  amount: 150000,
  status: 'ISSUED',
  issuedAt: NOW,
  seat: 'C7',
  transactionId: 'txn-1',
});
const MISSING = Symbol('missing');
const body = (ids: string[] = [R1], brand: unknown = 'VISA') => ({
  reservationIds: ids,
  card: {
    ...(brand === MISSING ? {} : { brand }),
    number: '4111111111111111',
    expiry: '12/28',
    cvv: '123',
  },
});

interface Setup {
  /** Reservas que devuelve la lectura previa (por defecto, una ACTIVE por cada id pedido). */
  reservations?: Record<string, object>;
  expired?: Record<string, boolean>;
  event?: object;
  locked?: object[];
  claimed?: boolean;
  soldCount?: number;
  confirmedCount?: number;
  knownTransaction?: boolean;
}

function setup(overrides: Setup = {}) {
  const trx = { trx: true } as unknown as Db;
  const db = {
    transaction: () => ({ execute: (cb: (t: Db) => unknown) => cb(trx) }),
  } as unknown as Db;
  const prior = overrides.reservations ?? {};
  const reservations = {
    findManyForPurchase: vi.fn().mockImplementation(async (ids: string[]) =>
      ids
        .filter((id) => prior[id] !== null)
        .map((id) => ({
          reservation: { ...reservationOf(id), ...prior[id] },
          expired: overrides.expired?.[id] ?? false,
        })),
    ),
    lockManyByIds: vi
      .fn()
      .mockImplementation(
        async (ids: string[]) => overrides.locked ?? ids.map((id) => reservationOf(id)),
      ),
    markConfirmedMany: vi
      .fn()
      .mockImplementation(async (ids: string[]) => overrides.confirmedCount ?? ids.length),
    attachToOrder: vi.fn().mockResolvedValue(undefined),
    claimForPayment: vi.fn().mockResolvedValue(overrides.claimed ?? true),
    releaseClaim: vi.fn().mockResolvedValue(undefined),
  };
  const events = {
    getById: vi.fn().mockResolvedValue({ id: 'event-1', status: 'ACTIVE', ...overrides.event }),
    findForShare: vi
      .fn()
      .mockResolvedValue({ id: 'event-1', status: 'ACTIVE', ...overrides.event }),
  };
  const seats = {
    lockByIds: vi.fn().mockResolvedValue([]),
    markSoldMany: vi
      .fn()
      .mockImplementation(async (ids: string[]) => overrides.soldCount ?? ids.length),
  };
  const payments = {
    charge: vi.fn().mockResolvedValue({ transactionId: 'txn-1' }),
    recordApproved: vi.fn().mockResolvedValue({ id: 'pay-1' }),
    recordRefundPending: vi.fn().mockResolvedValue({ id: 'pay-1' }),
    markRefundPending: vi.fn().mockResolvedValue(0),
    existsByTransactionId: vi.fn().mockResolvedValue(overrides.knownTransaction ?? false),
  };
  const orders = { create: vi.fn().mockResolvedValue({ id: 'order-1' }) };
  const tickets: Record<string, ReturnType<typeof vi.fn>> & {
    createMany: ReturnType<typeof vi.fn>;
  } = {
    createMany: vi.fn().mockResolvedValue(undefined),
    // Los tickets aparecen después de crearse: uno por reserva del último `createMany`
    findByOrder: vi
      .fn()
      .mockImplementation(async () =>
        (tickets.createMany.mock.calls.at(-1)?.[0] as { reservationId: string }[]).map((t) =>
          ticketOf(t.reservationId),
        ),
      ),
    listByUser: vi.fn(),
    cancelByEvent: vi.fn().mockResolvedValue({ ticketCount: 3, paymentIds: ['pay-1', 'pay-2'] }),
  };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Logger & {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  const service = new TicketService(
    tickets as never,
    reservations as never,
    events as never,
    seats as never,
    payments as never,
    orders as never,
    db,
    logger,
    30,
  );
  return { service, reservations, events, seats, payments, orders, tickets, trx, logger };
}

describe('gatewayIdFor', () => {
  it('uses the reservation id itself when there is only one', () => {
    expect(gatewayIdFor([R1])).toBe(R1);
  });

  it('is the same UUID v5 for the same set in any order', () => {
    const id = gatewayIdFor([R1, R2, R3]);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(gatewayIdFor([R3, R1, R2])).toBe(id);
  });

  it('differs for two sets that share the lowest id', () => {
    expect(gatewayIdFor([R1, R2])).not.toBe(gatewayIdFor([R1, R3]));
    expect(gatewayIdFor([R1, R2])).not.toBe(R1);
  });
});

describe('TicketService.purchase', () => {
  it('issues one ticket with the reservation amount for a single reservation', async () => {
    const { service, payments, tickets, seats, reservations, orders, trx } = setup();
    const result = await service.purchase('user-1', body([R1]));
    expect(result).toMatchObject({ orderId: 'order-1', amount: 150000 });
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0]).toMatchObject({
      reservationId: R1,
      status: 'ISSUED',
      transactionId: 'txn-1',
    });
    expect(payments.charge).toHaveBeenCalledTimes(1);
    expect(payments.charge).toHaveBeenCalledWith({
      reservationId: R1,
      amount: 150000,
      card: { brand: 'VISA', number: '4111111111111111', expiry: '12/28', cvv: '123' },
    });
    expect(orders.create).toHaveBeenCalledWith(
      { userId: 'user-1', eventId: 'event-1', amount: 150000 },
      trx,
    );
    expect(reservations.markConfirmedMany).toHaveBeenCalledWith([R1], trx);
    expect(seats.markSoldMany).toHaveBeenCalledWith(['seat-1'], trx);
    expect(reservations.attachToOrder).toHaveBeenCalledWith([R1], 'order-1', trx);
    expect(tickets.createMany).toHaveBeenCalledTimes(1);
    expect(payments.recordApproved).toHaveBeenCalledWith(
      { orderId: 'order-1', transactionId: 'txn-1', amount: 150000 },
      trx,
    );
  });

  it('charges once for three reservations and returns the tickets in the requested order', async () => {
    const { service, payments, tickets } = setup();
    const result = await service.purchase('user-1', body([R3, R1, R2]));
    expect(payments.charge).toHaveBeenCalledTimes(1);
    expect(payments.charge).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 450000, reservationId: gatewayIdFor([R1, R2, R3]) }),
    );
    expect(result.amount).toBe(450000);
    expect(result.tickets.map((t) => t.reservationId)).toEqual([R3, R1, R2]);
    expect(tickets.createMany.mock.calls[0]![0]).toHaveLength(3);
  });

  it('sums in whole cents without float errors (3 x 33.33 and 8 x 0.01)', async () => {
    const thirds = setup({
      reservations: { [R1]: { amount: 33.33 }, [R2]: { amount: 33.33 }, [R3]: { amount: 33.33 } },
    });
    expect((await thirds.service.purchase('user-1', body([R1, R2, R3]))).amount).toBe(99.99);
    const ids = Array.from({ length: 8 }, (_, i) => `${i + 1}0000000-0000-4000-8000-000000000000`);
    const cents = setup({
      reservations: Object.fromEntries(ids.map((id) => [id, { amount: 0.01 }])),
    });
    expect((await cents.service.purchase('user-1', body(ids))).amount).toBe(0.08);
  });

  describe('maximum order amount', () => {
    it('accepts a single reservation at the maximum price and three that add up exactly to it', async () => {
      const single = setup({ reservations: { [R1]: { amount: 9_999_999_999.99 } } });
      expect((await single.service.purchase('user-1', body([R1]))).amount).toBe(9_999_999_999.99);
      const triple = setup({
        reservations: {
          [R1]: { amount: 3_333_333_333.33 },
          [R2]: { amount: 3_333_333_333.33 },
          [R3]: { amount: 3_333_333_333.33 },
        },
      });
      expect((await triple.service.purchase('user-1', body([R1, R2, R3]))).amount).toBe(
        9_999_999_999.99,
      );
    });

    it('rejects a total above the maximum before claiming or calling the gateway', async () => {
      const { service, payments, reservations } = setup({
        reservations: { [R1]: { amount: 5_000_000_000 }, [R2]: { amount: 5_000_000_000 } },
      });
      await expect(service.purchase('user-1', body([R1, R2]))).rejects.toMatchObject({
        code: 'ORDER_AMOUNT_TOO_LARGE',
        status: 400,
      });
      expect(reservations.claimForPayment).not.toHaveBeenCalled();
      expect(payments.charge).not.toHaveBeenCalled();
    });
  });

  describe('validation before charging', () => {
    it('validates the card brand before reading anything', async () => {
      const { service, reservations } = setup();
      await expect(service.purchase('user-1', body([R1], 'DINERS'))).rejects.toMatchObject({
        code: 'CARD_BRAND_NOT_ALLOWED',
      });
      await expect(service.purchase('user-1', body([R1], MISSING))).rejects.toMatchObject({
        code: 'CARD_BRAND_REQUIRED',
      });
      expect(reservations.findManyForPurchase).not.toHaveBeenCalled();
    });

    it('answers RESERVATION_NOT_FOUND when any reservation does not exist', async () => {
      const { service, payments } = setup({ reservations: { [R2]: null as never } });
      await expect(service.purchase('user-1', body([R1, R2]))).rejects.toMatchObject({
        code: 'RESERVATION_NOT_FOUND',
      });
      expect(payments.charge).not.toHaveBeenCalled();
    });

    it('answers FORBIDDEN when any reservation belongs to another user, before looking at their state', async () => {
      const { service, payments } = setup({
        reservations: { [R1]: { status: 'EXPIRED' }, [R2]: { userId: 'someone-else' } },
      });
      await expect(service.purchase('user-1', body([R1, R2]))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(payments.charge).not.toHaveBeenCalled();
    });

    it('answers RESERVATIONS_MISMATCH for reservations of different events', async () => {
      const { service, payments } = setup({ reservations: { [R2]: { eventId: 'event-2' } } });
      await expect(service.purchase('user-1', body([R1, R2]))).rejects.toMatchObject({
        code: 'RESERVATIONS_MISMATCH',
        status: 400,
      });
      expect(payments.charge).not.toHaveBeenCalled();
    });

    it.each([
      ['CONFIRMED', 'DUPLICATE_PAYMENT'],
      ['CANCELLED_BY_USER', 'RESERVATION_ALREADY_CANCELLED'],
      ['EXPIRED', 'RESERVATION_EXPIRED'],
      ['CANCELLED', 'RESERVATION_EXPIRED'],
    ])(
      'answers by the state %s of one reservation with %s, without claiming or charging',
      async (status, code) => {
        const { service, payments, reservations } = setup({ reservations: { [R2]: { status } } });
        await expect(service.purchase('user-1', body([R1, R2]))).rejects.toMatchObject({ code });
        expect(reservations.claimForPayment).not.toHaveBeenCalled();
        expect(payments.charge).not.toHaveBeenCalled();
      },
    );

    it('answers RESERVATION_EXPIRED for a vigent-looking reservation whose time already passed', async () => {
      const { service } = setup({ expired: { [R1]: true } });
      await expect(service.purchase('user-1', body([R1]))).rejects.toMatchObject({
        code: 'RESERVATION_EXPIRED',
      });
    });

    it('answers EVENT_CANCELLED when the event is cancelled', async () => {
      const { service } = setup({ event: { status: 'CANCELLED' } });
      await expect(service.purchase('user-1', body([R1]))).rejects.toMatchObject({
        code: 'EVENT_CANCELLED',
      });
    });

    it('reports the first problem in the order of the request', async () => {
      const first = setup({
        reservations: { [R1]: { status: 'EXPIRED' }, [R2]: { status: 'CONFIRMED' } },
      });
      await expect(first.service.purchase('user-1', body([R1, R2]))).rejects.toMatchObject({
        code: 'RESERVATION_EXPIRED',
      });
      const second = setup({
        reservations: { [R1]: { status: 'EXPIRED' }, [R2]: { status: 'CONFIRMED' } },
      });
      await expect(second.service.purchase('user-1', body([R2, R1]))).rejects.toMatchObject({
        code: 'DUPLICATE_PAYMENT',
      });
    });
  });

  describe('claim before charging', () => {
    it('answers PAYMENT_IN_PROGRESS without charging when a reservation is already being paid', async () => {
      const { service, payments, reservations } = setup({ claimed: false });
      await expect(service.purchase('user-1', body([R1, R2]))).rejects.toMatchObject({
        code: 'PAYMENT_IN_PROGRESS',
        status: 409,
      });
      expect(reservations.claimForPayment).toHaveBeenCalledWith([R1, R2], 30);
      expect(payments.charge).not.toHaveBeenCalled();
    });

    it('claims before charging', async () => {
      const { service, payments, reservations } = setup();
      await service.purchase('user-1', body([R1]));
      expect(reservations.claimForPayment.mock.invocationCallOrder[0]!).toBeLessThan(
        payments.charge.mock.invocationCallOrder[0]!,
      );
    });

    it.each([
      'PAYMENT_REJECTED',
      'CARD_PROBLEM',
      'PAYMENT_GATEWAY_ERROR',
      'VALIDATION_ERROR',
      'INTERNAL_ERROR',
    ] as const)(
      'releases the claim after %s so the user can try again right away',
      async (code) => {
        const { service, payments, reservations } = setup();
        payments.charge.mockRejectedValueOnce(new AppError(code));
        await expect(service.purchase('user-1', body([R1]))).rejects.toMatchObject({ code });
        expect(reservations.releaseClaim).toHaveBeenCalledWith([R1]);
      },
    );

    it('keeps the claim after a gateway timeout, because the result of the charge is unknown', async () => {
      const { service, payments, reservations } = setup();
      payments.charge.mockRejectedValueOnce(new AppError('PAYMENT_GATEWAY_TIMEOUT'));
      await expect(service.purchase('user-1', body([R1]))).rejects.toMatchObject({
        code: 'PAYMENT_GATEWAY_TIMEOUT',
      });
      expect(reservations.releaseClaim).not.toHaveBeenCalled();
    });

    it('does not touch the reservations, seats or tickets when the payment fails', async () => {
      const { service, payments, reservations, seats, tickets } = setup();
      payments.charge.mockRejectedValueOnce(new AppError('PAYMENT_REJECTED'));
      await expect(service.purchase('user-1', body([R1]))).rejects.toThrow();
      expect(reservations.markConfirmedMany).not.toHaveBeenCalled();
      expect(seats.markSoldMany).not.toHaveBeenCalled();
      expect(tickets.createMany).not.toHaveBeenCalled();
      expect(payments.recordApproved).not.toHaveBeenCalled();
      expect(payments.recordRefundPending).not.toHaveBeenCalled();
    });
  });

  describe('purchase in flight', () => {
    it('records one REFUND_PENDING payment and answers EVENT_CANCELLED when the event was cancelled during the payment', async () => {
      const { service, events, payments, tickets, orders, trx, reservations } = setup();
      events.findForShare.mockResolvedValue({ id: 'event-1', status: 'CANCELLED' });
      await expect(service.purchase('user-1', body([R1, R2, R3]))).rejects.toMatchObject({
        code: 'EVENT_CANCELLED',
      });
      expect(orders.create).toHaveBeenCalledTimes(1);
      expect(payments.recordRefundPending).toHaveBeenCalledTimes(1);
      expect(payments.recordRefundPending).toHaveBeenCalledWith(
        { orderId: 'order-1', transactionId: 'txn-1', amount: 450000 },
        trx,
      );
      expect(tickets.createMany).not.toHaveBeenCalled();
      expect(payments.recordApproved).not.toHaveBeenCalled();
      expect(reservations.releaseClaim).toHaveBeenCalledWith([R1, R2, R3]);
    });

    it('answers RESERVATION_EXPIRED when one reservation was released during the payment', async () => {
      const { service, payments, tickets } = setup({
        locked: [reservationOf(R1), reservationOf(R2, { status: 'EXPIRED' })],
      });
      await expect(service.purchase('user-1', body([R1, R2]))).rejects.toMatchObject({
        code: 'RESERVATION_EXPIRED',
      });
      expect(payments.recordRefundPending).toHaveBeenCalledOnce();
      expect(tickets.createMany).not.toHaveBeenCalled();
    });

    it('answers RESERVATION_ALREADY_CANCELLED when the owner cancelled one reservation during the payment', async () => {
      const { service, payments, tickets } = setup({
        locked: [reservationOf(R1), reservationOf(R2, { status: 'CANCELLED_BY_USER' })],
      });
      await expect(service.purchase('user-1', body([R1, R2]))).rejects.toMatchObject({
        code: 'RESERVATION_ALREADY_CANCELLED',
      });
      expect(payments.recordRefundPending).toHaveBeenCalledOnce();
      expect(tickets.createMany).not.toHaveBeenCalled();
    });

    it('records the charge as REFUND_PENDING (outside the failed transaction) and rethrows on an unexpected failure', async () => {
      const { service, seats, payments, reservations } = setup();
      seats.markSoldMany.mockResolvedValueOnce(0);
      await expect(service.purchase('user-1', body([R1]))).rejects.toThrow('state changed');
      // El cobro queda registrado aparte (en su propia transacción), no dentro de la que falló
      expect(payments.recordRefundPending).toHaveBeenCalledOnce();
      expect(payments.recordApproved).not.toHaveBeenCalled();
      expect(reservations.releaseClaim).toHaveBeenCalledWith([R1]);
    });

    it('logs for manual reconciliation (without card data) if even the refund record fails', async () => {
      const { service, seats, payments, logger } = setup();
      seats.markSoldMany.mockResolvedValueOnce(0);
      payments.recordRefundPending.mockRejectedValueOnce(new Error('db down'));
      await expect(service.purchase('user-1', body([R1]))).rejects.toThrow('state changed');
      expect(logger.error).toHaveBeenCalledOnce();
      const logged = JSON.stringify(logger.error.mock.calls);
      expect(logged).toContain('txn-1');
      expect(logged).not.toContain('4111111111111111');
      expect(logged).not.toContain('123"');
    });
  });

  describe('a charge that finds the reservations already paid (the claim expired during a slow charge)', () => {
    const paid = { locked: [reservationOf(R1, { status: 'CONFIRMED' })] };

    it('answers DUPLICATE_PAYMENT and records nothing when the gateway returned the same transaction', async () => {
      const { service, payments, orders, tickets } = setup({ ...paid, knownTransaction: true });
      await expect(service.purchase('user-1', body([R1]))).rejects.toMatchObject({
        code: 'DUPLICATE_PAYMENT',
      });
      expect(orders.create).not.toHaveBeenCalled();
      expect(payments.recordRefundPending).not.toHaveBeenCalled();
      expect(tickets.createMany).not.toHaveBeenCalled();
    });

    it('records the extra charge as REFUND_PENDING and warns when the transaction is a different one', async () => {
      const { service, payments, logger, tickets } = setup({ ...paid, knownTransaction: false });
      await expect(service.purchase('user-1', body([R1]))).rejects.toMatchObject({
        code: 'DUPLICATE_PAYMENT',
      });
      expect(payments.recordRefundPending).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(tickets.createMany).not.toHaveBeenCalled();
    });
  });
});

describe('TicketService.cancelByEvent', () => {
  it('cancels the tickets, marks each payment REFUND_PENDING once and returns the ticket count', async () => {
    const { service, tickets, payments, trx } = setup();
    // 3 tickets comparten 2 pagos: el resultado cuenta tickets, no pagos
    expect(await service.cancelByEvent('event-1', trx)).toBe(3);
    expect(tickets.cancelByEvent).toHaveBeenCalledWith('event-1', trx);
    expect(payments.markRefundPending).toHaveBeenCalledWith(['pay-1', 'pay-2'], trx);
  });
});
