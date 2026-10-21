import type { Selectable } from 'kysely';
import type { Db } from '../../db/database.js';
import type { Events } from '../../db/types.js';
import { escapeLike } from '../../shared/utils/sql-like.js';
import { offsetOf, type PaginationParams } from '../../shared/utils/pagination.js';
import {
  EVENT_STATUSES,
  type Event,
  type EventFilters,
  type EventStatus,
  type EventType,
  type NewEvent,
} from './event.types.js';

export interface EventRepository {
  create(event: NewEvent, executor?: Db): Promise<Event>;
  findById(id: string): Promise<Event | null>;
  /** Pasa el evento a CANCELLED solo si está ACTIVE. Devuelve false si no cambió nada. */
  markCancelled(id: string, executor?: Db): Promise<boolean>;
  /** Lee el evento con SELECT ... FOR SHARE: una cancelación simultánea espera a que termine la transacción. */
  findForShare(id: string, executor?: Db): Promise<Event | null>;
  list(filters: EventFilters, page: PaginationParams): Promise<{ items: Event[]; total: number }>;
}

function toEvent(row: Selectable<Events>): Event {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as EventType,
    venue: row.venue,
    price: Number(row.price), // numeric llega como string desde pg
    capacity: row.capacity,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as EventStatus,
    createdAt: row.created_at,
  };
}

export class KyselyEventRepository implements EventRepository {
  constructor(private readonly db: Db) {}

  async create(event: NewEvent, executor: Db = this.db): Promise<Event> {
    const row = await executor
      .insertInto('events')
      .values({
        name: event.name,
        description: event.description,
        type: event.type,
        venue: event.venue,
        price: event.price,
        capacity: event.capacity,
        start_date: event.startDate,
        end_date: event.endDate,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toEvent(row);
  }

  async findForShare(id: string, executor: Db = this.db): Promise<Event | null> {
    const row = await executor
      .selectFrom('events')
      .selectAll()
      .where('id', '=', id)
      .forShare()
      .executeTakeFirst();
    return row ? toEvent(row) : null;
  }

  async markCancelled(id: string, executor: Db = this.db): Promise<boolean> {
    // UPDATE condicional: es la barrera contra cancelaciones simultáneas
    const result = await executor
      .updateTable('events')
      .set({ status: EVENT_STATUSES.CANCELLED })
      .where('id', '=', id)
      .where('status', '=', EVENT_STATUSES.ACTIVE)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async findById(id: string): Promise<Event | null> {
    const row = await this.db
      .selectFrom('events')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toEvent(row) : null;
  }

  async list(filters: EventFilters, page: PaginationParams) {
    // Los mismos filtros alimentan la página y el conteo total
    const filtered = this.db
      .selectFrom('events')
      .$if(filters.status !== undefined, (qb) => qb.where('status', '=', filters.status as string))
      .$if(filters.type !== undefined, (qb) => qb.where('type', '=', filters.type as string))
      .$if(filters.startFrom !== undefined, (qb) =>
        qb.where('start_date', '>=', filters.startFrom as Date),
      )
      .$if(filters.startTo !== undefined, (qb) =>
        qb.where('start_date', '<=', filters.startTo as Date),
      )
      .$if(filters.search !== undefined, (qb) =>
        qb.where('name', 'ilike', `%${escapeLike(filters.search as string)}%`),
      );

    const [{ count }, rows] = await Promise.all([
      filtered.select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirstOrThrow(),
      filtered
        .selectAll()
        .orderBy('start_date')
        .orderBy('id')
        .limit(page.pageSize)
        .offset(offsetOf(page))
        .execute(),
    ]);
    return { items: rows.map(toEvent), total: Number(count) };
  }
}
