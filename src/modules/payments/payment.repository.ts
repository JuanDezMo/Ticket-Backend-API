import type { Selectable } from 'kysely';
import type { Db } from '../../db/database.js';
import type { Payments } from '../../db/types.js';
import {
  PAYMENT_STATUSES,
  type NewPayment,
  type Payment,
  type PaymentStatus,
} from './payment.types.js';

export interface PaymentRepository {
  create(payment: NewPayment, executor?: Db): Promise<Payment>;
  /** Pasa los pagos indicados a REFUND_PENDING. Devuelve cuántos cambió. */
  markRefundPending(paymentIds: string[], executor?: Db): Promise<number>;
}

function toPayment(row: Selectable<Payments>): Payment {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    userId: row.user_id,
    eventId: row.event_id,
    transactionId: row.transaction_id,
    amount: Number(row.amount),
    status: row.status as PaymentStatus,
    createdAt: row.created_at,
  };
}

export class KyselyPaymentRepository implements PaymentRepository {
  constructor(private readonly db: Db) {}

  async create(payment: NewPayment, executor: Db = this.db): Promise<Payment> {
    const row = await executor
      .insertInto('payments')
      .values({
        reservation_id: payment.reservationId,
        user_id: payment.userId,
        event_id: payment.eventId,
        transaction_id: payment.transactionId,
        amount: payment.amount,
        status: payment.status,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toPayment(row);
  }

  async markRefundPending(paymentIds: string[], executor: Db = this.db): Promise<number> {
    if (paymentIds.length === 0) return 0;
    const result = await executor
      .updateTable('payments')
      .set({ status: PAYMENT_STATUSES.REFUND_PENDING })
      .where('id', 'in', paymentIds)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}
