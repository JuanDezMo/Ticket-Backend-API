import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KyselyEventRepository } from '../../src/modules/events/event.repository.js';
import { EventService } from '../../src/modules/events/event.service.js';
import type { PaymentGateway } from '../../src/modules/payments/payment-gateway.js';
import { KyselyPaymentRepository } from '../../src/modules/payments/payment.repository.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import { KyselyReservationRepository } from '../../src/modules/reservations/reservation.repository.js';
import { ReservationService } from '../../src/modules/reservations/reservation.service.js';
import { KyselySeatRepository } from '../../src/modules/seats/seat.repository.js';
import { SeatService } from '../../src/modules/seats/seat.service.js';
import { KyselyTicketRepository } from '../../src/modules/tickets/ticket.repository.js';
import { TicketService } from '../../src/modules/tickets/ticket.service.js';
import { createLogger } from '../../src/shared/logger.js';
import { CARD, reserveSeat } from '../helpers/purchase.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('unexpected failure while issuing the ticket after the charge', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  it('reverts seat and reservation, keeps the charge as REFUND_PENDING and rethrows', async () => {
    const { reservation } = await reserveSeat(ctx.app, ctx.db);
    const userId = (
      await ctx.db.selectFrom('reservations').select('user_id').executeTakeFirstOrThrow()
    ).user_id;

    class FailingTicketRepository extends KyselyTicketRepository {
      override async create(): Promise<{ id: string }> {
        throw new Error('ticket insert failed');
      }
    }
    const gateway: PaymentGateway = {
      charge: async () => ({ kind: 'approved', transactionId: 'txn-failure-1' }),
    };
    const logger = createLogger('silent');
    const seats = new SeatService(new KyselySeatRepository(ctx.db));
    const events = new EventService(new KyselyEventRepository(ctx.db), seats, ctx.db);
    const service = new TicketService(
      new FailingTicketRepository(ctx.db),
      new ReservationService(new KyselyReservationRepository(ctx.db), seats, events, ctx.db, 10, 8),
      events,
      seats,
      new PaymentService(gateway, new KyselyPaymentRepository(ctx.db), logger),
      ctx.db,
      logger,
    );

    await expect(
      service.purchase(userId, { reservationId: reservation.id, card: CARD }),
    ).rejects.toThrow('ticket insert failed');

    const reservationRow = await ctx.db
      .selectFrom('reservations')
      .select('status')
      .where('id', '=', reservation.id)
      .executeTakeFirstOrThrow();
    const seatRow = await ctx.db
      .selectFrom('seats')
      .select('status')
      .where('id', '=', reservation.seatId)
      .executeTakeFirstOrThrow();
    expect(reservationRow.status).toBe('ACTIVE');
    expect(seatRow.status).toBe('RESERVED');
    expect(await ctx.db.selectFrom('tickets').selectAll().execute()).toHaveLength(0);
    const payments = await ctx.db.selectFrom('payments').selectAll().execute();
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      status: 'REFUND_PENDING',
      transaction_id: 'txn-failure-1',
    });
  });
});
