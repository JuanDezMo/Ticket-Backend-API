import type { Db } from '../../db/database.js';
import { AppError } from '../../shared/errors/index.js';
import { isUniqueViolation } from '../../shared/utils/db-errors.js';
import { EVENT_STATUSES } from '../events/event.types.js';
import type { EventService } from '../events/event.service.js';
import { parseSeatLabel } from '../seats/seat-label.js';
import { SEAT_STATUSES, type Seat, type SeatPosition } from '../seats/seat.types.js';
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
    private readonly maxActiveHolds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Crea un lote de reservas (todas o ninguna) con el mismo vencimiento. Orden de validaciones:
   * evento activo, seats existentes, límite del evento, tope global y, al final, disponibilidad.
   */
  async create(
    userId: string,
    input: { eventId: string; seats: string[] },
  ): Promise<PublicReservation[]> {
    // 1. El evento se valida antes que los seats: un evento cancelado tiene sus seats BLOQUEADOS
    const event = await this.events.getById(input.eventId); // 404 EVENT_NOT_FOUND
    if (event.status !== EVENT_STATUSES.ACTIVE || event.startDate <= this.now()) {
      throw new AppError('EVENT_NOT_ACTIVE');
    }

    // 2. Todos los seats existen en ese evento (una sola consulta)
    const positions = input.seats.map((label) => parseSeatLabel(label));
    if (positions.some((position) => position === null)) throw new AppError('SEAT_NOT_FOUND');
    const found = await this.seats.findByEventAndLabels(event.id, positions as SeatPosition[]);
    const byLabel = new Map(found.map((seat) => [`${seat.row}${seat.number}`, seat]));
    if (input.seats.some((label) => !byLabel.has(label))) throw new AppError('SEAT_NOT_FOUND');
    const requested = input.seats.map((label) => byLabel.get(label) as Seat);

    // 3. Todo el resto ocurre en una transacción, bajo el bloqueo del usuario
    const created = await this.db.transaction().execute(async (trx) => {
      await this.reservations.lockHoldsOf(userId, trx);
      await this.reservations.releaseExpired(event.id, trx);

      const heldInEvent = await this.reservations.countHoldsForEvent(userId, event.id, trx);
      if (heldInEvent + requested.length > event.maxSeatsPerUser) {
        throw new AppError(
          'SEAT_LIMIT_REACHED',
          `You can hold up to ${event.maxSeatsPerUser} seats for this event`,
        );
      }
      const activeHolds = await this.reservations.countActiveHolds(userId, trx);
      if (activeHolds + requested.length > this.maxActiveHolds) {
        throw new AppError('HOLD_LIMIT_REACHED');
      }

      // Bloqueo en orden de id y comprobación de disponibilidad con el estado ya bloqueado
      const ids = requested.map((seat) => seat.id);
      const locked = await this.seats.lockByIds(ids, trx);
      const taken = locked.filter((seat) => seat.status !== SEAT_STATUSES.AVAILABLE);
      if (taken.length > 0 || locked.length !== requested.length) {
        // En el orden en que se pidieron, no en el de bloqueo
        const takenIds = new Set(taken.map((seat) => seat.id));
        const labels = requested
          .filter((seat) => takenIds.has(seat.id))
          .map((seat) => `${seat.row}${seat.number}`)
          .join(', ');
        throw new AppError('SEAT_NOT_AVAILABLE', `Seats not available: ${labels || 'unknown'}`);
      }
      if ((await this.seats.markReservedMany(ids, trx)) !== ids.length) {
        throw new AppError('SEAT_NOT_AVAILABLE');
      }

      try {
        return await this.reservations.createMany(
          requested.map((seat) => ({
            userId,
            seatId: seat.id,
            eventId: event.id,
            amount: event.price,
          })),
          this.ttlMinutes,
          trx,
        );
      } catch (error) {
        // Segunda defensa: el índice único parcial (una reserva ACTIVE por seat)
        if (isUniqueViolation(error)) throw new AppError('SEAT_NOT_AVAILABLE');
        throw error;
      }
    });

    // 4. La respuesta sigue el orden de la solicitud
    const bySeatId = new Map(created.map((reservation) => [reservation.seatId, reservation]));
    return requested.map((seat) =>
      toPublicReservation(bySeatId.get(seat.id) as Reservation, `${seat.row}${seat.number}`),
    );
  }

  async getForOwner(userId: string, id: string): Promise<PublicReservation> {
    const found = await this.reservations.findForPurchase(id);
    if (!found) throw new AppError('RESERVATION_NOT_FOUND');
    const { reservation, expired } = found;
    // El dueño se valida antes de leer cualquier otro dato de la reserva
    if (reservation.userId !== userId) throw new AppError('FORBIDDEN');

    const seat = await this.seats.findById(reservation.seatId);
    // No debería pasar por la clave foránea: es un error inesperado, no de negocio. Un Error
    // normal (no AppError) hace que el errorHandler lo registre en el log y responda 500 genérico
    if (!seat)
      throw new Error(`Seat ${reservation.seatId} not found for reservation ${reservation.id}`);

    // Estado efectivo (RN-RES-8): una ACTIVE vencida según la hora de la BD se informa como
    // EXPIRED, con el mismo criterio de la compra (RN-RES-7). No se escribe: la liberación
    // es trabajo del job y del listado/reserva (RN-RES-6), y un GET no debe tener efectos.
    const status =
      reservation.status === RESERVATION_STATUSES.ACTIVE && expired
        ? RESERVATION_STATUSES.EXPIRED
        : reservation.status;
    return toPublicReservation({ ...reservation, status }, `${seat.row}${seat.number}`);
  }

  async cancelByOwner(userId: string, id: string): Promise<PublicReservation> {
    // 1. Existencia y dueño, antes de abrir la transacción y de revelar cualquier otro dato
    const found = await this.reservations.findForPurchase(id);
    if (!found) throw new AppError('RESERVATION_NOT_FOUND');
    if (found.reservation.userId !== userId) throw new AppError('FORBIDDEN');

    // 2. Bloqueos en orden evento -> reserva -> seat, igual que la compra. La cancelación del
    // evento hace UPDATE del evento antes de tocar seats y reservas, así que FOR SHARE espera
    // a que termine y las dos quedan en fila: no hay interbloqueo.
    const cancelled = await this.db.transaction().execute(async (trx) => {
      const event = await this.events.findForShare(found.reservation.eventId, trx);
      const locked = await this.reservations.lockById(id, trx);
      if (!locked) throw new AppError('RESERVATION_NOT_FOUND');

      switch (locked.status) {
        case RESERVATION_STATUSES.CANCELLED_BY_USER:
          throw new AppError('RESERVATION_ALREADY_CANCELLED');
        case RESERVATION_STATUSES.CONFIRMED:
          throw new AppError('RESERVATION_ALREADY_CONFIRMED');
        case RESERVATION_STATUSES.CANCELLED:
          throw new AppError('EVENT_CANCELLED');
        case RESERVATION_STATUSES.EXPIRED:
          throw new AppError('RESERVATION_EXPIRED');
      }
      if (!event || event.status !== EVENT_STATUSES.ACTIVE) throw new AppError('EVENT_CANCELLED');

      // El UPDATE solo cambia una reserva vigente según la hora de la BD (RN-RES-7)
      if (!(await this.reservations.markCancelledByUser(id, trx))) {
        throw new AppError('RESERVATION_EXPIRED');
      }
      await this.seats.releaseReserved(locked.seatId, trx);
      return { ...locked, status: RESERVATION_STATUSES.CANCELLED_BY_USER };
    });

    const seat = await this.seats.findById(cancelled.seatId);
    // Igual que en getForOwner: inesperado por la clave foránea, el errorHandler lo registra
    if (!seat) {
      throw new Error(`Seat ${cancelled.seatId} not found for reservation ${cancelled.id}`);
    }
    return toPublicReservation(cancelled, `${seat.row}${seat.number}`);
  }

  findManyForPurchase(ids: string[]) {
    return this.reservations.findManyForPurchase(ids);
  }

  lockManyByIds(ids: string[], executor: Db): Promise<Reservation[]> {
    return this.reservations.lockManyByIds(ids, executor);
  }

  markConfirmedMany(ids: string[], executor: Db): Promise<number> {
    return this.reservations.markConfirmedMany(ids, executor);
  }

  attachToOrder(ids: string[], orderId: string, executor: Db): Promise<void> {
    return this.reservations.attachToOrder(ids, orderId, executor);
  }

  /** Todo o nada: false si alguna reserva ya tiene un pago en curso (no se reclama ninguna). */
  claimForPayment(ids: string[], claimSeconds: number): Promise<boolean> {
    return this.reservations.claimForPayment(ids, claimSeconds);
  }

  hasRecentClaim(ids: string[], claimSeconds: number): Promise<boolean> {
    return this.reservations.hasRecentClaim(ids, claimSeconds);
  }

  releaseClaim(ids: string[]): Promise<void> {
    return this.reservations.releaseClaim(ids);
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
