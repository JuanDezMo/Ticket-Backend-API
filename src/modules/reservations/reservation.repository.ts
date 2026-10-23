import { sql, type Selectable } from 'kysely';
import type { Db } from '../../db/database.js';
import type { Reservations } from '../../db/types.js';
import {
  RESERVATION_STATUSES,
  type NewReservation,
  type Reservation,
  type ReservationStatus,
} from './reservation.types.js';
import { SEAT_STATUSES } from '../seats/seat.types.js';

export interface ReservationRepository {
  /** `expires_at` se calcula con la hora de la BD: now() + ttlMinutes. */
  create(reservation: NewReservation, ttlMinutes: number, executor?: Db): Promise<Reservation>;
  /**
   * Inserta todas las reservas del lote en una sola sentencia: comparten `created_at` y `expires_at`
   * (`now()` es constante dentro de la transacción).
   */
  createMany(
    reservations: NewReservation[],
    ttlMinutes: number,
    executor?: Db,
  ): Promise<Reservation[]>;
  /**
   * Bloqueo de asesoría por usuario, liberado al terminar la transacción: serializa las creaciones
   * de reservas de un mismo usuario para que el conteo y la inserción no se crucen.
   */
  lockHoldsOf(userId: string, executor: Db): Promise<void>;
  /** Reservas del usuario en el evento que cuentan para el límite: ACTIVE vigentes y CONFIRMED. */
  countHoldsForEvent(userId: string, eventId: string, executor?: Db): Promise<number>;
  /** Reservas ACTIVE vigentes del usuario en todos los eventos (tope global). */
  countActiveHolds(userId: string, executor?: Db): Promise<number>;
  /** Libera las reservas vencidas (todas, o solo las de un evento). Devuelve cuántos seats liberó. */
  releaseExpired(eventId?: string, executor?: Db): Promise<number>;
  /** Libera las vencidas del evento y cancela las ACTIVE restantes. Devuelve cuántas canceló. */
  cancelActiveByEvent(eventId: string, executor?: Db): Promise<number>;
  /** Busca la reserva e indica si venció según la hora de la BD (expires_at <= now()). */
  findForPurchase(id: string): Promise<{ reservation: Reservation; expired: boolean } | null>;
  /** Las reservas pedidas con el indicador de vencida según la hora de la BD (las inexistentes no aparecen). */
  findManyForPurchase(ids: string[]): Promise<{ reservation: Reservation; expired: boolean }[]>;
  /** SELECT ... ORDER BY id FOR UPDATE: bloquea las reservas siempre por id ascendente. */
  lockManyByIds(ids: string[], executor: Db): Promise<Reservation[]>;
  /** ACTIVE -> CONFIRMED para varias, en una sola sentencia, y limpia el reclamo. Devuelve cuántas cambió. */
  markConfirmedMany(ids: string[], executor: Db): Promise<number>;
  /** Asocia las reservas al pedido. */
  attachToOrder(ids: string[], orderId: string, executor: Db): Promise<void>;
  /**
   * Reclamo atómico antes de cobrar: marca `payment_started_at = now()` en todas las reservas, solo si
   * están ACTIVE, vigentes y sin un reclamo reciente. Todo o nada: devuelve false (y no deja nada
   * reclamado) si alguna ya está reclamada. Toma las filas con SKIP LOCKED: nunca espera a otra solicitud.
   */
  claimForPayment(ids: string[], claimSeconds: number): Promise<boolean>;
  /** Limpia el reclamo de las reservas indicadas. */
  releaseClaim(ids: string[]): Promise<void>;
  /** SELECT ... FOR UPDATE: serializa compras simultáneas de la misma reserva. */
  lockById(id: string, executor: Db): Promise<Reservation | null>;
  /** ACTIVE -> CONFIRMED. Devuelve false si la reserva ya no estaba ACTIVE. */
  markConfirmed(id: string, executor: Db): Promise<boolean>;
  /**
   * ACTIVE y vigente -> CANCELLED_BY_USER. El vencimiento se decide con la hora de la BD en el
   * mismo UPDATE. Devuelve false si la reserva ya no estaba ACTIVE o ya venció.
   */
  markCancelledByUser(id: string, executor: Db): Promise<boolean>;
}

function toReservation(row: Selectable<Reservations>): Reservation {
  return {
    id: row.id,
    userId: row.user_id,
    seatId: row.seat_id,
    eventId: row.event_id,
    status: row.status as ReservationStatus,
    orderId: row.order_id,
    amount: Number(row.amount),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/** Señal interna: no se pudieron reclamar todas las reservas; revierte la transacción del reclamo. */
class ClaimNotAvailable extends Error {}

export class KyselyReservationRepository implements ReservationRepository {
  constructor(private readonly db: Db) {}

  async create(reservation: NewReservation, ttlMinutes: number, executor: Db = this.db) {
    const row = await executor
      .insertInto('reservations')
      .values({
        user_id: reservation.userId,
        seat_id: reservation.seatId,
        event_id: reservation.eventId,
        amount: reservation.amount,
        expires_at: sql`now() + make_interval(mins => ${ttlMinutes})`,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toReservation(row);
  }

  async createMany(reservations: NewReservation[], ttlMinutes: number, executor: Db = this.db) {
    if (reservations.length === 0) return [];
    const rows = await executor
      .insertInto('reservations')
      .values(
        reservations.map((reservation) => ({
          user_id: reservation.userId,
          seat_id: reservation.seatId,
          event_id: reservation.eventId,
          amount: reservation.amount,
          expires_at: sql<Date>`now() + make_interval(mins => ${ttlMinutes})`,
        })),
      )
      .returningAll()
      .execute();
    return rows.map(toReservation);
  }

  async lockHoldsOf(userId: string, executor: Db): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reservation-holds:${userId}`}, 0))`.execute(
      executor,
    );
  }

  async countHoldsForEvent(userId: string, eventId: string, executor: Db = this.db) {
    const { count } = await executor
      .selectFrom('reservations')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('user_id', '=', userId)
      .where('event_id', '=', eventId)
      .where((eb) =>
        eb.or([
          eb('status', '=', RESERVATION_STATUSES.CONFIRMED),
          eb.and([
            eb('status', '=', RESERVATION_STATUSES.ACTIVE),
            sql<boolean>`expires_at > now()`,
          ]),
        ]),
      )
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  async countActiveHolds(userId: string, executor: Db = this.db) {
    const { count } = await executor
      .selectFrom('reservations')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('user_id', '=', userId)
      .where('status', '=', RESERVATION_STATUSES.ACTIVE)
      .where(sql<boolean>`expires_at > now()`)
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  async findForPurchase(id: string) {
    const row = await this.db
      .selectFrom('reservations')
      .selectAll()
      .select(sql<boolean>`expires_at <= now()`.as('expired'))
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? { reservation: toReservation(row), expired: row.expired } : null;
  }

  async findManyForPurchase(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.db
      .selectFrom('reservations')
      .selectAll()
      .select(sql<boolean>`expires_at <= now()`.as('expired'))
      .where('id', 'in', ids)
      .execute();
    return rows.map((row) => ({ reservation: toReservation(row), expired: row.expired }));
  }

  async lockManyByIds(ids: string[], executor: Db): Promise<Reservation[]> {
    if (ids.length === 0) return [];
    const rows = await executor
      .selectFrom('reservations')
      .selectAll()
      .where('id', 'in', ids)
      .orderBy('id')
      .forUpdate()
      .execute();
    return rows.map(toReservation);
  }

  async markConfirmedMany(ids: string[], executor: Db): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await executor
      .updateTable('reservations')
      .set({ status: RESERVATION_STATUSES.CONFIRMED, payment_started_at: null })
      .where('id', 'in', ids)
      .where('status', '=', RESERVATION_STATUSES.ACTIVE)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async attachToOrder(ids: string[], orderId: string, executor: Db): Promise<void> {
    if (ids.length === 0) return;
    await executor
      .updateTable('reservations')
      .set({ order_id: orderId })
      .where('id', 'in', ids)
      .execute();
  }

  async claimForPayment(ids: string[], claimSeconds: number): Promise<boolean> {
    if (ids.length === 0) return false;
    // Una transacción corta: si no se reclaman todas, se revierte y no queda ninguna reclamada
    return this.db
      .transaction()
      .execute(async (trx) => {
        const result = await sql`
        WITH free AS MATERIALIZED (
          SELECT id FROM reservations
          WHERE id IN (${sql.join(ids)})
            AND status = ${sql.lit(RESERVATION_STATUSES.ACTIVE)}
            AND expires_at > now()
            AND (payment_started_at IS NULL
                 OR payment_started_at < now() - make_interval(secs => ${claimSeconds}))
          ORDER BY id
          FOR UPDATE SKIP LOCKED
        )
        UPDATE reservations SET payment_started_at = now()
        WHERE id IN (SELECT id FROM free)
      `.execute(trx);
        if (Number(result.numAffectedRows ?? 0) !== ids.length) {
          // Sin deshacer la transacción no basta con retornar: se aborta para que no quede nada reclamado
          throw new ClaimNotAvailable();
        }
        return true;
      })
      .catch((error) => {
        if (error instanceof ClaimNotAvailable) return false;
        throw error;
      });
  }

  async releaseClaim(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .updateTable('reservations')
      .set({ payment_started_at: null })
      .where('id', 'in', ids)
      .execute();
  }

  async lockById(id: string, executor: Db): Promise<Reservation | null> {
    const row = await executor
      .selectFrom('reservations')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    return row ? toReservation(row) : null;
  }

  async markConfirmed(id: string, executor: Db): Promise<boolean> {
    const result = await executor
      .updateTable('reservations')
      .set({ status: RESERVATION_STATUSES.CONFIRMED })
      .where('id', '=', id)
      .where('status', '=', RESERVATION_STATUSES.ACTIVE)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async markCancelledByUser(id: string, executor: Db): Promise<boolean> {
    const result = await executor
      .updateTable('reservations')
      .set({ status: RESERVATION_STATUSES.CANCELLED_BY_USER })
      .where('id', '=', id)
      .where('status', '=', RESERVATION_STATUSES.ACTIVE)
      .where(sql<boolean>`expires_at > now()`)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async cancelActiveByEvent(eventId: string, executor: Db = this.db): Promise<number> {
    // Las vencidas pasan a EXPIRED y no cuentan como canceladas
    await this.releaseExpired(eventId, executor);
    const result = await executor
      .updateTable('reservations')
      .set({ status: RESERVATION_STATUSES.CANCELLED })
      .where('event_id', '=', eventId)
      .where('status', '=', RESERVATION_STATUSES.ACTIVE)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async releaseExpired(eventId?: string, executor: Db = this.db): Promise<number> {
    // Excepción consciente: este repository también modifica `seats`, porque marcar la
    // reserva como vencida y liberar el seat deben ocurrir juntos, en una sola sentencia atómica.
    // Sin esperas cruzadas entre ejecuciones simultáneas:
    //  - las reservas vencidas se toman con `ORDER BY id FOR UPDATE SKIP LOCKED`: las que otra
    //    transacción ya está liberando se saltan en lugar de esperarse;
    //  - los seats se bloquean después, por id ascendente, el mismo orden con que los bloquea un
    //    lote de reservas (`SeatRepository.lockByIds`), así no se cruzan con él.
    // Es idempotente: una ejecución que llega tarde no encuentra filas ACTIVE vencidas.
    const eventFilter = eventId ? sql`AND event_id = ${eventId}` : sql``;
    const result = await sql`
      WITH due AS MATERIALIZED (
        SELECT id FROM reservations
        WHERE status = ${sql.lit(RESERVATION_STATUSES.ACTIVE)} AND expires_at <= now() ${eventFilter}
        ORDER BY id
        FOR UPDATE SKIP LOCKED
      ),
      expired AS (
        UPDATE reservations SET status = ${sql.lit(RESERVATION_STATUSES.EXPIRED)}
        WHERE id IN (SELECT id FROM due)
        RETURNING seat_id
      ),
      locked_seats AS MATERIALIZED (
        SELECT id FROM seats
        WHERE id IN (SELECT seat_id FROM expired)
        ORDER BY id
        FOR UPDATE
      )
      UPDATE seats SET status = ${sql.lit(SEAT_STATUSES.AVAILABLE)}
      WHERE id IN (SELECT id FROM locked_seats) AND status = ${sql.lit(SEAT_STATUSES.RESERVED)}
    `.execute(executor);
    return Number(result.numAffectedRows ?? 0);
  }
}
