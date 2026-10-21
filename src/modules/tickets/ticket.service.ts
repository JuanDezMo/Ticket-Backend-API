import type { Db } from '../../db/database.js';
import { AppError, type ErrorCode } from '../../shared/errors/index.js';
import type { Logger } from '../../shared/logger.js';
import { paginate, type Page, type PaginationParams } from '../../shared/utils/pagination.js';
import { EVENT_STATUSES } from '../events/event.types.js';
import type { EventService } from '../events/event.service.js';
import { parseCardBrand } from '../payments/card-brand.js';
import type { PaymentService } from '../payments/payment.service.js';
import { RESERVATION_STATUSES, type Reservation } from '../reservations/reservation.types.js';
import type { ReservationService } from '../reservations/reservation.service.js';
import type { SeatService } from '../seats/seat.service.js';
import type { PurchaseBody } from './ticket.schemas.js';
import type { TicketRepository } from './ticket.repository.js';
import type { PublicTicket, Ticket, TicketListItem } from './ticket.types.js';

export function toPublicTicket(ticket: Ticket): PublicTicket {
  return {
    id: ticket.id,
    reservationId: ticket.reservationId,
    eventId: ticket.eventId,
    seat: ticket.seat,
    status: ticket.status,
    amount: ticket.amount,
    transactionId: ticket.transactionId,
    issuedAt: ticket.issuedAt.toISOString(),
  };
}

export interface PurchaseResult {
  ticket: PublicTicket;
  /** false cuando la reserva ya tenía ticket (repetición idempotente). */
  created: boolean;
}

type IssueOutcome =
  | { kind: 'issued'; ticket: Ticket }
  | { kind: 'replay'; ticket: Ticket }
  | { kind: 'refund'; code: ErrorCode };

export class TicketService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly reservations: ReservationService,
    private readonly events: EventService,
    private readonly seats: SeatService,
    private readonly payments: PaymentService,
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async purchase(userId: string, input: PurchaseBody): Promise<PurchaseResult> {
    // 1. La franquicia se valida antes de tocar la BD o la pasarela
    const brand = parseCardBrand(input.card.brand);

    // 2. La reserva debe existir y ser del usuario
    const found = await this.reservations.findForPurchase(input.reservationId);
    if (!found) throw new AppError('RESERVATION_NOT_FOUND');
    const { reservation, expired } = found;
    if (reservation.userId !== userId) throw new AppError('FORBIDDEN');

    // 3. Idempotencia: si ya tiene ticket, se devuelve el mismo sin cobrar de nuevo
    const existing = await this.tickets.findByReservation(reservation.id);
    if (existing) return { ticket: toPublicTicket(existing), created: false };

    // 4. Evento activo y reserva vigente (según la hora de la BD)
    const event = await this.events.getById(reservation.eventId);
    if (event.status !== EVENT_STATUSES.ACTIVE) throw new AppError('EVENT_CANCELLED');
    if (reservation.status === RESERVATION_STATUSES.CANCELLED_BY_USER) {
      throw new AppError('RESERVATION_ALREADY_CANCELLED');
    }
    if (reservation.status !== RESERVATION_STATUSES.ACTIVE || expired) {
      throw new AppError('RESERVATION_EXPIRED');
    }

    // 5. Cobro: una sola llamada, FUERA de cualquier transacción de BD
    const { transactionId } = await this.payments.charge({
      reservationId: reservation.id,
      amount: reservation.amount,
      card: { brand, number: input.card.number, expiry: input.card.expiry, cvv: input.card.cvv },
    });

    // 6. Cobro aprobado: emitir el ticket (o dejar el pago en REFUND_PENDING si ya no se puede)
    const payment = {
      reservationId: reservation.id,
      userId,
      eventId: reservation.eventId,
      transactionId,
      amount: reservation.amount,
    };
    let outcome: IssueOutcome;
    try {
      outcome = await this.db.transaction().execute((trx) => this.issue(reservation, payment, trx));
    } catch (error) {
      // Fallo inesperado después de cobrar: no se pierde el rastro del cobro
      await this.recordRefundAfterFailure(payment);
      throw error;
    }
    if (outcome.kind === 'refund') throw new AppError(outcome.code);
    return { ticket: toPublicTicket(outcome.ticket), created: outcome.kind === 'issued' };
  }

  listMine(userId: string, page: PaginationParams): Promise<Page<TicketListItem>> {
    return this.tickets
      .listByUser(userId, page)
      .then(({ items, total }) => paginate(items, page, total));
  }

  /** Paso de la cascada de cancelación de un evento: tickets a CANCELLED_BY_EVENT y pagos a REFUND_PENDING. */
  async cancelByEvent(eventId: string, executor: Db): Promise<number> {
    const paymentIds = await this.tickets.cancelByEvent(eventId, executor);
    await this.payments.markRefundPending(paymentIds, executor);
    return paymentIds.length;
  }

  /**
   * Bloqueos en orden evento -> reserva -> seat: coincide con la cancelación de eventos (toma el
   * evento primero) y con la liberación de vencidas (reservas y luego seats); evita interbloqueos.
   */
  private async issue(
    reservation: Reservation,
    payment: Parameters<PaymentService['recordApproved']>[0],
    trx: Db,
  ): Promise<IssueOutcome> {
    const event = await this.events.findForShare(reservation.eventId, trx);
    const locked = await this.reservations.lockById(reservation.id, trx);

    // Otra solicitud simultánea ya emitió el ticket
    if (locked?.status === RESERVATION_STATUSES.CONFIRMED) {
      const ticket = await this.tickets.findByReservation(reservation.id, trx);
      if (ticket) return { kind: 'replay', ticket };
    }

    if (!event || event.status !== EVENT_STATUSES.ACTIVE) {
      await this.payments.recordRefundPending(payment, trx);
      return { kind: 'refund', code: 'EVENT_CANCELLED' };
    }
    // El dueño canceló la reserva mientras se cobraba
    if (locked?.status === RESERVATION_STATUSES.CANCELLED_BY_USER) {
      await this.payments.recordRefundPending(payment, trx);
      return { kind: 'refund', code: 'RESERVATION_ALREADY_CANCELLED' };
    }
    if (!locked || locked.status !== RESERVATION_STATUSES.ACTIVE) {
      await this.payments.recordRefundPending(payment, trx);
      return { kind: 'refund', code: 'RESERVATION_EXPIRED' };
    }

    const confirmed = await this.reservations.markConfirmed(reservation.id, trx);
    const sold = await this.seats.markSold(reservation.seatId, trx);
    // Si algo no cuadra se revierte todo (la excepción deshace la transacción)
    if (!confirmed || !sold)
      throw new Error('Reservation or seat state changed while issuing the ticket');

    const approved = await this.payments.recordApproved(payment, trx);
    await this.tickets.create(
      {
        reservationId: reservation.id,
        paymentId: approved.id,
        userId: reservation.userId,
        eventId: reservation.eventId,
        seatId: reservation.seatId,
        amount: reservation.amount,
      },
      trx,
    );
    const ticket = await this.tickets.findByReservation(reservation.id, trx);
    if (!ticket) throw new Error('Ticket was not found right after being created');
    return { kind: 'issued', ticket };
  }

  private async recordRefundAfterFailure(payment: Parameters<PaymentService['recordApproved']>[0]) {
    try {
      await this.payments.recordRefundPending(payment);
    } catch (error) {
      // Último recurso: dejar el rastro en el log para conciliación manual (sin datos de tarjeta)
      this.logger.error(
        { err: error, transactionId: payment.transactionId, reservationId: payment.reservationId },
        'Charged payment could not be recorded; manual reconciliation required',
      );
    }
  }
}
