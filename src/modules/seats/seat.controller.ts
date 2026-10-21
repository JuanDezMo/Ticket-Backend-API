import type { Request, Response } from 'express';
import type { EventService } from '../events/event.service.js';
import type { SeatsQuery } from './seat.schemas.js';
import type { SeatService } from './seat.service.js';

export class SeatController {
  constructor(
    private readonly seatService: SeatService,
    private readonly eventService: EventService,
  ) {}

  listByEvent = async (_req: Request, res: Response): Promise<void> => {
    const { id } = res.locals.params as { id: string };
    const { status } = res.locals.query as SeatsQuery;
    // Falla con EVENT_NOT_FOUND si el evento no existe
    await this.eventService.getById(id);
    res.status(200).json({ eventId: id, data: await this.seatService.listByEvent(id, status) });
  };
}
