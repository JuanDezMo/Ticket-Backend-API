import type { Db } from '../../db/database.js';
import { generateSeatLayout } from './seat-layout.js';
import type { SeatRepository } from './seat.repository.js';
import type { PublicSeat, Seat, SeatStatus } from './seat.types.js';

export function toPublicSeat(seat: Seat): PublicSeat {
  return {
    id: seat.id,
    row: seat.row,
    number: seat.number,
    label: `${seat.row}${seat.number}`,
    status: seat.status,
  };
}

export class SeatService {
  constructor(private readonly seats: SeatRepository) {}

  /** Crea los seats del evento dentro de la transacción recibida. */
  generateForEvent(eventId: string, capacity: number, executor: Db): Promise<void> {
    return this.seats.insertMany(eventId, generateSeatLayout(capacity), executor);
  }

  async listByEvent(eventId: string, status?: SeatStatus): Promise<PublicSeat[]> {
    return (await this.seats.findByEvent(eventId, status)).map(toPublicSeat);
  }
}
