import type { Db } from '../../db/database.js';
import { AppError } from '../../shared/errors/index.js';
import type { EventService } from '../events/event.service.js';
import { EVENT_STATUSES } from '../events/event.types.js';
import type { CancellationStep, CancellationStepName } from './cancellation-step.js';

export interface CancellationResult {
  id: string;
  status: typeof EVENT_STATUSES.CANCELLED;
  cancelledReservations: number;
  cancelledTickets: number;
}

export class CancellationService {
  constructor(
    private readonly events: EventService,
    // El orden importa (ver container.ts): seats antes que reservas
    private readonly steps: CancellationStep[],
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async cancel(eventId: string): Promise<CancellationResult> {
    const event = await this.events.getById(eventId); // 404 EVENT_NOT_FOUND
    if (event.status === EVENT_STATUSES.CANCELLED) throw new AppError('EVENT_ALREADY_CANCELLED');
    if (event.endDate <= this.now()) throw new AppError('EVENT_ALREADY_ENDED');

    const counts = await this.db.transaction().execute(async (trx) => {
      // Barrera contra cancelaciones simultáneas: solo una transacción logra el UPDATE
      if (!(await this.events.markCancelled(event.id, trx))) {
        throw new AppError('EVENT_ALREADY_CANCELLED');
      }
      const result: Partial<Record<CancellationStepName, number>> = {};
      for (const step of this.steps) {
        result[step.name] = (result[step.name] ?? 0) + (await step.execute(event.id, trx));
      }
      return result;
    });

    return {
      id: event.id,
      status: EVENT_STATUSES.CANCELLED,
      cancelledReservations: counts.reservations ?? 0,
      // 0 mientras no haya un paso "tickets" registrado
      cancelledTickets: counts.tickets ?? 0,
    };
  }
}
