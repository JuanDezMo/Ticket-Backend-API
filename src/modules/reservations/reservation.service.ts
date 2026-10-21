import type { Db } from '../../db/database.js';
import { AppError } from '../../shared/errors/index.js';
import { isUniqueViolation } from '../../shared/utils/db-errors.js';
import { EVENT_STATUSES } from '../events/event.types.js';
import type { EventService } from '../events/event.service.js';
import { parseSeatLabel } from '../seats/seat-label.js';
import type { SeatService } from '../seats/seat.service.js';
import type { ReservationRepository } from './reservation.repository.js';
import {
  RESERVATION_STATUSES,
  type Reservation,
  type PublicReservation,
} from './reservation.types.js';

export function toPublicReservation(
  reservation: Reservation,
  seatLabel: string,
): PublicReservation {
  return {
    id: reservation.id,
    eventId: reservation.eventId,
    seatId: reservation.seatId,
    seat: seatLabel,
    status: reservation.status,
    amount: reservation.amount,
    expiresAt: reservation.expiresAt.toISOString(),
    createdAt: reservation.createdAt.toISOString(),
  };
}

export class ReservationService {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly seats: SeatService,
    private readonly events: EventService,
    private readonly db: Db,
    private readonly ttlMinutes: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    userId: string,
    input: { eventId: string; seat: string },
  ): Promise<PublicReservation> {
    // 1. El evento se valida antes que el seat: un evento cancelado tiene sus seats BLOQUEADOS
    const event = await this.events.getById(input.eventId); // 404 EVENT_NOT_FOUND
    if (event.status !== EVENT_STATUSES.ACTIVE || event.startDate <= this.now()) {
      throw new AppError('EVENT_NOT_ACTIVE');
    }

    // 2. El seat se busca dentro de ese evento
    const position = parseSeatLabel(input.seat);
    const seat = position ? await this.seats.findByEventAndLabel(event.id, position) : null;
    if (!seat) throw new AppError('SEAT_NOT_FOUND');

    // 3. Liberar vencidas, marcar el seat e insertar la reserva: todo o nada
    const reservation = await this.db.transaction().execute(async (trx) => {
      await this.reservations.releaseExpired(event.id, trx);
      if (!(await this.seats.markReserved(seat.id, trx))) throw new AppError('SEAT_NOT_AVAILABLE');
      try {
        return await this.reservations.create(
          { userId, seatId: seat.id, eventId: event.id, amount: event.price },
          this.ttlMinutes,
          trx,
        );
      } catch (error) {
        // Segunda defensa: el índice único parcial (una reserva ACTIVE por seat)
        if (isUniqueViolation(error)) throw new AppError('SEAT_NOT_AVAILABLE');
        throw error;
      }
    });
    return toPublicReservation(reservation, `${seat.row}${seat.number}`);
  }

  async getForOwner(userId: string, id: string): Promise<PublicReservation> {
    const found = await this.reservations.findForPurchase(id);
    if (!found) throw new AppError('RESERVATION_NOT_FOUND');
    const { reservation, expired } = found;
    // El dueño se valida antes de leer cualquier otro dato de la reserva
    if (reservation.userId !== userId) throw new AppError('FORBIDDEN');

    const seat = await this.seats.findById(reservation.seatId);
    if (!seat) throw new AppError('INTERNAL_ERROR');

    // Estado efectivo (RN-RES-8): una ACTIVE vencida según la hora de la BD se informa como
    // EXPIRED, con el mismo criterio de la compra (RN-RES-7). No se escribe: la liberación
    // es trabajo del job y del listado/reserva (RN-RES-6), y un GET no debe tener efectos.
    const status =
      reservation.status === RESERVATION_STATUSES.ACTIVE && expired
        ? RESERVATION_STATUSES.EXPIRED
        : reservation.status;
    return toPublicReservation({ ...reservation, status }, `${seat.row}${seat.number}`);
  }

  findForPurchase(id: string) {
    return this.reservations.findForPurchase(id);
  }

  lockById(id: string, executor: Db): Promise<Reservation | null> {
    return this.reservations.lockById(id, executor);
  }

  markConfirmed(id: string, executor: Db): Promise<boolean> {
    return this.reservations.markConfirmed(id, executor);
  }

  cancelActiveByEvent(eventId: string, executor: Db): Promise<number> {
    return this.reservations.cancelActiveByEvent(eventId, executor);
  }

  /** Libera las reservas vencidas de un evento (o de todos si no se indica). */
  releaseExpired(eventId?: string): Promise<number> {
    return this.reservations.releaseExpired(eventId);
  }
}
