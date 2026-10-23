import type { Db } from '../../db/database.js';
import type { OrderRepository } from './order.repository.js';
import type { NewOrder, Order } from './order.types.js';

export class OrderService {
  constructor(private readonly orders: OrderRepository) {}

  create(order: NewOrder, executor?: Db): Promise<Order> {
    return this.orders.create(order, executor);
  }
}
