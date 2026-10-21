import type { Db } from '../../db/database.js';
import { offsetOf, type PaginationParams } from '../../shared/utils/pagination.js';
import {
  TICKET_STATUSES,
  type NewTicket,
  type Ticket,
  type TicketListItem,
  type TicketStatus,
} from './ticket.types.js';

export interface TicketRepository {
  create(ticket: NewTicket, executor: Db): Promise<{ id: string }>;
  /** Ticket de la reserva con la etiqueta del seat y el transactionId del pago. */
  findByReservation(reservationId: string, executor?: Db): Promise<Ticket | null>;
  listByUser(
    userId: string,
    page: PaginationParams,
  ): Promise<{ items: TicketListItem[]; total: number }>;
  /** ISSUED -> CANCELLED_BY_EVENT. Devuelve los ids de los pagos asociados. */
  cancelByEvent(eventId: string, executor: Db): Promise<string[]>;
}

export class KyselyTicketRepository implements TicketRepository {
  constructor(private readonly db: Db) {}

  async create(ticket: NewTicket, executor: Db): Promise<{ id: string }> {
    return executor
      .insertInto('tickets')
      .values({
        reservation_id: ticket.reservationId,
        payment_id: ticket.paymentId,
        user_id: ticket.userId,
        event_id: ticket.eventId,
        seat_id: ticket.seatId,
        amount: ticket.amount,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  async findByReservation(reservationId: string, executor: Db = this.db): Promise<Ticket | null> {
    // Lectura con joins a seats y payments para armar la respuesta; no modifica esas tablas
    const row = await executor
      .selectFrom('tickets')
      .innerJoin('seats', 'seats.id', 'tickets.seat_id')
      .innerJoin('payments', 'payments.id', 'tickets.payment_id')
      .select([
        'tickets.id',
        'tickets.reservation_id',
        'tickets.payment_id',
        'tickets.user_id',
        'tickets.event_id',
        'tickets.seat_id',
        'tickets.amount',
        'tickets.status',
        'tickets.issued_at',
        'seats.row',
        'seats.number',
        'payments.transaction_id',
      ])
      .where('tickets.reservation_id', '=', reservationId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      reservationId: row.reservation_id,
      paymentId: row.payment_id,
      userId: row.user_id,
      eventId: row.event_id,
      seatId: row.seat_id,
      amount: Number(row.amount),
      status: row.status as TicketStatus,
      issuedAt: row.issued_at,
      seat: `${row.row}${row.number}`,
      transactionId: row.transaction_id,
    };
  }

  async listByUser(userId: string, page: PaginationParams) {
    const base = this.db.selectFrom('tickets').where('tickets.user_id', '=', userId);
    const [{ count }, rows] = await Promise.all([
      base.select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirstOrThrow(),
      base
        .innerJoin('seats', 'seats.id', 'tickets.seat_id')
        .innerJoin('events', 'events.id', 'tickets.event_id')
        .select([
          'tickets.id',
          'tickets.status',
          'tickets.amount',
          'tickets.issued_at',
          'seats.row',
          'seats.number',
          'events.id as event_id',
          'events.name as event_name',
          'events.venue as event_venue',
          'events.start_date as event_start_date',
        ])
        .orderBy('tickets.issued_at', 'desc')
        .orderBy('tickets.id')
        .limit(page.pageSize)
        .offset(offsetOf(page))
        .execute(),
    ]);
    const items: TicketListItem[] = rows.map((row) => ({
      id: row.id,
      status: row.status as TicketStatus,
      seat: `${row.row}${row.number}`,
      amount: Number(row.amount),
      issuedAt: row.issued_at.toISOString(),
      event: {
        id: row.event_id,
        name: row.event_name,
        venue: row.event_venue,
        startDate: row.event_start_date.toISOString(),
      },
    }));
    return { items, total: Number(count) };
  }

  async cancelByEvent(eventId: string, executor: Db): Promise<string[]> {
    const rows = await executor
      .updateTable('tickets')
      .set({ status: TICKET_STATUSES.CANCELLED_BY_EVENT })
      .where('event_id', '=', eventId)
      .where('status', '=', TICKET_STATUSES.ISSUED)
      .returning('payment_id')
      .execute();
    return rows.map((row) => row.payment_id);
  }
}
