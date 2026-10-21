import type { Selectable } from 'kysely';
import type { Db } from '../../db/database.js';
import type { Seats } from '../../db/types.js';
import { SEAT_STATUSES, type Seat, type SeatPosition, type SeatStatus } from './seat.types.js';

export interface SeatRepository {
  /** Inserta todos los seats en una sola sentencia; acepta una transacción. */
  insertMany(eventId: string, positions: SeatPosition[], executor?: Db): Promise<void>;
  findByEvent(eventId: string, status?: SeatStatus): Promise<Seat[]>;
  /** Busca un seat dentro de un evento concreto por su posición (fila y número). */
  findByEventAndPosition(eventId: string, position: SeatPosition): Promise<Seat | null>;
  /** Pasa el seat a RESERVED solo si está AVAILABLE. Devuelve false si no cambió nada. */
  markReserved(seatId: string, executor?: Db): Promise<boolean>;
  /** Pasa a BLOCKED todos los seats del evento que no lo estén. Devuelve cuántos cambió. */
  blockAllByEvent(eventId: string, executor?: Db): Promise<number>;
}

function toSeat(row: Selectable<Seats>): Seat {
  return {
    id: row.id,
    eventId: row.event_id,
    row: row.row,
    number: row.number,
    status: row.status as SeatStatus,
  };
}

export class KyselySeatRepository implements SeatRepository {
  constructor(private readonly db: Db) {}

  async insertMany(eventId: string, positions: SeatPosition[], executor: Db = this.db) {
    if (positions.length === 0) return;
    await executor
      .insertInto('seats')
      .values(positions.map(({ row, number }) => ({ event_id: eventId, row, number })))
      .execute();
  }

  async findByEventAndPosition(
    eventId: string,
    { row, number }: SeatPosition,
  ): Promise<Seat | null> {
    const found = await this.db
      .selectFrom('seats')
      .selectAll()
      .where('event_id', '=', eventId)
      .where('row', '=', row)
      .where('number', '=', number)
      .executeTakeFirst();
    return found ? toSeat(found) : null;
  }

  async markReserved(seatId: string, executor: Db = this.db): Promise<boolean> {
    // UPDATE condicional: es la barrera contra la doble reserva
    const result = await executor
      .updateTable('seats')
      .set({ status: SEAT_STATUSES.RESERVED })
      .where('id', '=', seatId)
      .where('status', '=', SEAT_STATUSES.AVAILABLE)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async blockAllByEvent(eventId: string, executor: Db = this.db): Promise<number> {
    const result = await executor
      .updateTable('seats')
      .set({ status: SEAT_STATUSES.BLOCKED })
      .where('event_id', '=', eventId)
      .where('status', '<>', SEAT_STATUSES.BLOCKED)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async findByEvent(eventId: string, status?: SeatStatus): Promise<Seat[]> {
    const rows = await this.db
      .selectFrom('seats')
      .selectAll()
      .where('event_id', '=', eventId)
      .$if(status !== undefined, (qb) => qb.where('status', '=', status as SeatStatus))
      .orderBy('row')
      .orderBy('number')
      .execute();
    return rows.map(toSeat);
  }
}
