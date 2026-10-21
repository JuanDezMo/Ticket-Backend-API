import type { Db } from '../../db/database.js';
import { AppError } from '../../shared/errors/index.js';
import { paginate, type Page, type PaginationParams } from '../../shared/utils/pagination.js';
import type { SeatService } from '../seats/seat.service.js';
import type { EventRepository } from './event.repository.js';
import type { Event, EventFilters, NewEvent, PublicEvent } from './event.types.js';

export function toPublicEvent(event: Event): PublicEvent {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    type: event.type,
    venue: event.venue,
    price: event.price,
    capacity: event.capacity,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    createdAt: event.createdAt.toISOString(),
    status: event.status,
  };
}

export class EventService {
  constructor(
    private readonly events: EventRepository,
    private readonly seats: SeatService,
    private readonly db: Db,
  ) {}

  /** Crea el evento y sus seats en una sola transacción: o queda todo o no queda nada. */
  create(input: NewEvent): Promise<Event> {
    return this.db.transaction().execute(async (trx) => {
      const event = await this.events.create(input, trx);
      await this.seats.generateForEvent(event.id, event.capacity, trx);
      return event;
    });
  }

  async list(filters: EventFilters, page: PaginationParams): Promise<Page<PublicEvent>> {
    const { items, total } = await this.events.list(filters, page);
    return paginate(items.map(toPublicEvent), page, total);
  }

  async getById(id: string): Promise<Event> {
    const event = await this.events.findById(id);
    if (!event) throw new AppError('EVENT_NOT_FOUND');
    return event;
  }
}
