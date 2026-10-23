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
  /** ¿Ya existe un pago con ese transactionId? (es único) */
  existsByTransactionId(transactionId: string, executor?: Db): Promise<boolean>;
}

function toPayment(row: Selectable<Payments>): Payment {
  return {
    id: row.id,
    orderId: row.order_id,
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
        order_id: payment.orderId,
        transaction_id: payment.transactionId,
        amount: payment.amount,
        status: payment.status,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toPayment(row);
  }

  async existsByTransactionId(transactionId: string, executor: Db = this.db): Promise<boolean> {
    const row = await executor
      .selectFrom('payments')
      .select('id')
      .where('transaction_id', '=', transactionId)
      .executeTakeFirst();
    return row !== undefined;
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
