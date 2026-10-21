import type { Db } from '../../../db/database.js';
import type { TicketService } from '../../tickets/ticket.service.js';
import type { CancellationStep } from '../cancellation-step.js';

export class CancelTicketsStep implements CancellationStep {
  readonly name = 'tickets';

  constructor(private readonly tickets: TicketService) {}

  execute(eventId: string, trx: Db): Promise<number> {
    return this.tickets.cancelByEvent(eventId, trx);
  }
}
