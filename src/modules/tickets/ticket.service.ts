import type { Db } from '../../db/database.js';
import { AppError, type ErrorCode } from '../../shared/errors/index.js';
import type { Logger } from '../../shared/logger.js';
import { paginate, type Page, type PaginationParams } from '../../shared/utils/pagination.js';
import { EVENT_STATUSES } from '../events/event.types.js';
import type { EventService } from '../events/event.service.js';
import { parseCardBrand } from '../payments/card-brand.js';
import type { PaymentService } from '../payments/payment.service.js';
import { RESERVATION_STATUSES } from '../reservations/reservation.types.js';
import type { ReservationService } from '../reservations/reservation.service.js';
import type { OrderService } from '../orders/order.service.js';
import type { SeatService } from '../seats/seat.service.js';
import type { PurchaseBody } from './ticket.schemas.js';
import { uuidV5 } from '../../shared/utils/uuid-v5.js';
import type { TicketRepository } from './ticket.repository.js';
import {
  MAX_ORDER_AMOUNT_CENTS,
  type PublicTicket,
  type PurchaseResult,
  type Ticket,
  type TicketListItem,
} from './ticket.types.js';

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

/** Espacio de nombres fijo para derivar el identificador de un conjunto de reservas (UUID v5). */
const GATEWAY_ID_NAMESPACE = '3f6d9b5e-1c42-4a8e-9f7a-2d5b8c1e7a90';

/**
 * Identificador que se envía a la pasarela. Ella es idempotente solo por este id, así que debe
 * identificar el conjunto EXACTO de reservas: el id de la reserva si es una y, si son varias, un
 * UUID v5 de los ids ordenados (el mismo conjunto da siempre el mismo, en cualquier orden).
 */
export function gatewayIdFor(reservationIds: string[]): string {
  if (reservationIds.length === 1) return reservationIds[0]!;
  return uuidV5([...reservationIds].sort().join(','), GATEWAY_ID_NAMESPACE);
}

const CENTS = 100;

interface Charged {
  orderUserId: string;
  eventId: string;
  amount: number;
  transactionId: string;
}

type IssueOutcome =
  | { kind: 'issued'; orderId: string; tickets: Ticket[] }
  | { kind: 'refund'; code: ErrorCode }
  | { kind: 'duplicate' };

export class TicketService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly reservations: ReservationService,
    private readonly events: EventService,
    private readonly seats: SeatService,
    private readonly payments: PaymentService,
    private readonly orders: OrderService,
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly claimSeconds: number,
  ) {}

  /**
   * Paga de una vez todas las reservas indicadas (todo o nada): un solo cobro por la suma y un ticket
   * por reserva. Orden: validar, reclamar las reservas, cobrar (fuera de transacción) y emitir.
   */
  async purchase(userId: string, input: PurchaseBody): Promise<PurchaseResult> {
    // 1. La franquicia se valida antes de tocar la BD o la pasarela
    const brand = parseCardBrand(input.card.brand);
    const ids = input.reservationIds;

    // 2. Las reservas existen y son del usuario; todas del mismo evento
    const found = await this.reservations.findManyForPurchase(ids);
    const byId = new Map(found.map((item) => [item.reservation.id, item]));
    const ordered = ids.map((id) => byId.get(id));
    if (ordered.some((item) => item === undefined)) throw new AppError('RESERVATION_NOT_FOUND');
    const items = ordered as NonNullable<(typeof ordered)[number]>[];
    if (items.some(({ reservation }) => reservation.userId !== userId)) {
      throw new AppError('FORBIDDEN');
    }
    const eventId = items[0]!.reservation.eventId;
    if (items.some(({ reservation }) => reservation.eventId !== eventId)) {
      throw new AppError('RESERVATIONS_MISMATCH');
    }

    // 3. El primer problema, recorriendo las reservas en el orden de la solicitud
    const event = await this.events.getById(eventId);
    for (const { reservation, expired } of items) {
      if (reservation.status === RESERVATION_STATUSES.CONFIRMED) {
        throw new AppError('DUPLICATE_PAYMENT');
      }
      if (event.status !== EVENT_STATUSES.ACTIVE) throw new AppError('EVENT_CANCELLED');
      if (reservation.status === RESERVATION_STATUSES.CANCELLED_BY_USER) {
        throw new AppError('RESERVATION_ALREADY_CANCELLED');
      }
      if (reservation.status !== RESERVATION_STATUSES.ACTIVE || expired) {
        throw new AppError('RESERVATION_EXPIRED');
      }
    }

    // 4. El total, en centavos enteros (nunca sumando decimales de punto flotante)
    const cents = items.reduce(
      (sum, { reservation }) => sum + Math.round(reservation.amount * CENTS),
      0,
    );
    if (cents > MAX_ORDER_AMOUNT_CENTS) throw new AppError('ORDER_AMOUNT_TOO_LARGE');
    const amount = cents / CENTS;

    // 5. Reclamo atómico: si otra solicitud ya está cobrando alguna, no se llama a la pasarela
    if (!(await this.reservations.claimForPayment(ids, this.claimSeconds))) {
      throw new AppError('PAYMENT_IN_PROGRESS');
    }

    // 6. Cobro: una sola llamada, FUERA de cualquier transacción de BD
    let transactionId: string;
    try {
      ({ transactionId } = await this.payments.charge({
        reservationId: gatewayIdFor(ids),
        amount,
        card: { brand, number: input.card.number, expiry: input.card.expiry, cvv: input.card.cvv },
      }));
    } catch (error) {
      // Tras un timeout el resultado del cobro es desconocido: el reclamo se mantiene hasta vencer
      if (!(error instanceof AppError && error.code === 'PAYMENT_GATEWAY_TIMEOUT')) {
        await this.reservations.releaseClaim(ids);
      }
      throw error;
    }

    // 7. Cobro aprobado: emitir los tickets (o dejar el pago en REFUND_PENDING si ya no se puede)
    const charged: Charged = { orderUserId: userId, eventId, amount, transactionId };
    let outcome: IssueOutcome;
    try {
      outcome = await this.db.transaction().execute((trx) => this.issue(ids, charged, trx));
    } catch (error) {
      // Fallo inesperado después de cobrar: no se pierde el rastro del cobro
      await this.recordRefundAfterFailure(charged);
      await this.reservations.releaseClaim(ids);
      throw error;
    }
    if (outcome.kind === 'issued') {
      const byReservation = new Map(
        outcome.tickets.map((ticket) => [ticket.reservationId, ticket]),
      );
      return {
        orderId: outcome.orderId,
        amount,
        tickets: ids.map((id) => toPublicTicket(byReservation.get(id) as Ticket)),
      };
    }
    await this.reservations.releaseClaim(ids);
    throw new AppError(outcome.kind === 'refund' ? outcome.code : 'DUPLICATE_PAYMENT');
  }

  listMine(userId: string, page: PaginationParams): Promise<Page<TicketListItem>> {
    return this.tickets
      .listByUser(userId, page)
      .then(({ items, total }) => paginate(items, page, total));
  }

  /** Paso de la cascada de cancelación de un evento: tickets a CANCELLED_BY_EVENT y pagos a REFUND_PENDING. */
  async cancelByEvent(eventId: string, executor: Db): Promise<number> {
    const { ticketCount, paymentIds } = await this.tickets.cancelByEvent(eventId, executor);
    await this.payments.markRefundPending(paymentIds, executor);
    // Cuenta tickets, no pagos: varios tickets de un pedido comparten un pago
    return ticketCount;
  }

  /**
   * Bloqueos en orden evento -> reservas (por id) -> seats (por id): coincide con la cancelación de
   * eventos (toma el evento primero) y con la liberación de vencidas; evita interbloqueos.
   */
  private async issue(ids: string[], charged: Charged, trx: Db): Promise<IssueOutcome> {
    const event = await this.events.findForShare(charged.eventId, trx);
    const locked = await this.reservations.lockManyByIds(ids, trx);
    const payment = (orderId: string) => ({
      orderId,
      transactionId: charged.transactionId,
      amount: charged.amount,
    });
    const newOrder = () =>
      this.orders.create(
        { userId: charged.orderUserId, eventId: charged.eventId, amount: charged.amount },
        trx,
      );

    // Otra solicitud ya pagó alguna (el reclamo venció durante un cobro lento): este cobro es extra
    if (locked.some((reservation) => reservation.status === RESERVATION_STATUSES.CONFIRMED)) {
      if (!(await this.payments.existsByTransactionId(charged.transactionId, trx))) {
        // Doble cobro real: un transactionId distinto al del pedido existente
        this.logger.warn(
          { transactionId: charged.transactionId, reservationIds: ids },
          'Duplicate charge detected; payment kept as REFUND_PENDING for reconciliation',
        );
        const order = await newOrder();
        await this.payments.recordRefundPending(payment(order.id), trx);
      }
      return { kind: 'duplicate' };
    }

    let refund: ErrorCode | null = null;
    if (!event || event.status !== EVENT_STATUSES.ACTIVE) refund = 'EVENT_CANCELLED';
    else if (locked.length !== ids.length) refund = 'RESERVATION_EXPIRED';
    // El dueño canceló una reserva mientras se cobraba
    else if (locked.some((r) => r.status === RESERVATION_STATUSES.CANCELLED_BY_USER)) {
      refund = 'RESERVATION_ALREADY_CANCELLED';
    } else if (locked.some((r) => r.status !== RESERVATION_STATUSES.ACTIVE)) {
      refund = 'RESERVATION_EXPIRED';
    }
    if (refund) {
      const order = await newOrder();
      await this.payments.recordRefundPending(payment(order.id), trx);
      return { kind: 'refund', code: refund };
    }

    const seatIds = locked.map((reservation) => reservation.seatId);
    // Bloqueo de los seats por id y comprobación del estado ya bloqueado
    await this.seats.lockByIds(seatIds, trx);
    const confirmed = await this.reservations.markConfirmedMany(ids, trx);
    const sold = await this.seats.markSoldMany(seatIds, trx);
    // Si algo no cuadra se revierte todo (la excepción deshace la transacción)
    if (confirmed !== ids.length || sold !== ids.length) {
      throw new Error('Reservation or seat state changed while issuing the tickets');
    }

    const order = await newOrder();
    const approved = await this.payments.recordApproved(payment(order.id), trx);
    await this.reservations.attachToOrder(ids, order.id, trx);
    await this.tickets.createMany(
      locked.map((reservation) => ({
        reservationId: reservation.id,
        orderId: order.id,
        paymentId: approved.id,
        userId: reservation.userId,
        eventId: reservation.eventId,
        seatId: reservation.seatId,
        amount: reservation.amount,
      })),
      trx,
    );
    const tickets = await this.tickets.findByOrder(order.id, trx);
    if (tickets.length !== ids.length)
      throw new Error('Tickets were not found right after being created');
    return { kind: 'issued', orderId: order.id, tickets };
  }

  private async recordRefundAfterFailure(charged: Charged) {
    try {
      await this.db.transaction().execute(async (trx) => {
        const order = await this.orders.create(
          { userId: charged.orderUserId, eventId: charged.eventId, amount: charged.amount },
          trx,
        );
        await this.payments.recordRefundPending(
          { orderId: order.id, transactionId: charged.transactionId, amount: charged.amount },
          trx,
        );
      });
    } catch (error) {
      // Último recurso: dejar el rastro en el log para conciliación manual (sin datos de tarjeta)
      this.logger.error(
        { err: error, transactionId: charged.transactionId },
        'Charged payment could not be recorded; manual reconciliation required',
      );
    }
  }
}
