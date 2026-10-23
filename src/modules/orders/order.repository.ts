import type { Selectable } from 'kysely';
import type { Db } from '../../db/database.js';
import type { Orders } from '../../db/types.js';
import type { NewOrder, Order } from './order.types.js';

export interface OrderRepository {
  create(order: NewOrder, executor?: Db): Promise<Order>;
}

function toOrder(row: Selectable<Orders>): Order {
  return {
    id: row.id,
    userId: row.user_id,
    eventId: row.event_id,
    amount: Number(row.amount),
    createdAt: row.created_at,
  };
}

export class KyselyOrderRepository implements OrderRepository {
  constructor(private readonly db: Db) {}

  async create(order: NewOrder, executor: Db = this.db): Promise<Order> {
    const row = await executor
      .insertInto('orders')
      .values({ user_id: order.userId, event_id: order.eventId, amount: order.amount })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toOrder(row);
  }
}
