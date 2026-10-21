import type { Request, Response } from 'express';
import type { CreateEventBody, ListEventsQuery } from './event.schemas.js';
import { toPublicEvent, type EventService } from './event.service.js';

export class EventController {
  constructor(private readonly eventService: EventService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const event = await this.eventService.create(req.body as CreateEventBody);
    res.status(201).json(toPublicEvent(event));
  };

  list = async (_req: Request, res: Response): Promise<void> => {
    const { page, pageSize, ...filters } = res.locals.query as ListEventsQuery;
    res.status(200).json(await this.eventService.list(filters, { page, pageSize }));
  };
}
