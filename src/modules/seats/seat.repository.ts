import type { Selectable } from 'kysely';
import type { Db } from '../../db/database.js';
import type { Seats } from '../../db/types.js';
import type { Seat, SeatPosition, SeatStatus } from './seat.types.js';

export interface SeatRepository {
  /** Inserta todos los seats en una sola sentencia; acepta una transacción. */
  insertMany(eventId: string, positions: SeatPosition[], executor?: Db): Promise<void>;
  findByEvent(eventId: string, status?: SeatStatus): Promise<Seat[]>;
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
