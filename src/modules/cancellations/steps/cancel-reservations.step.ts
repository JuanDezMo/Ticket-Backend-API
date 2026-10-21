import type { Db } from '../../../db/database.js';
import type { ReservationService } from '../../reservations/reservation.service.js';
import type { CancellationStep } from '../cancellation-step.js';

export class CancelReservationsStep implements CancellationStep {
  readonly name = 'reservations';

  constructor(private readonly reservations: ReservationService) {}

  execute(eventId: string, trx: Db): Promise<number> {
    return this.reservations.cancelActiveByEvent(eventId, trx);
  }
}
