import type { Db } from '../../../db/database.js';
import type { SeatService } from '../../seats/seat.service.js';
import type { CancellationStep } from '../cancellation-step.js';

export class BlockSeatsStep implements CancellationStep {
  readonly name = 'seats';

  constructor(private readonly seats: SeatService) {}

  execute(eventId: string, trx: Db): Promise<number> {
    return this.seats.blockAllByEvent(eventId, trx);
  }
}
