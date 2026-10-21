import type { Db } from '../../db/database.js';
import { AppError } from '../../shared/errors/index.js';
import type { Logger } from '../../shared/logger.js';
import type { PaymentGateway } from './payment-gateway.js';
import type { PaymentRepository } from './payment.repository.js';
import {
  PAYMENT_STATUSES,
  type ChargeRequest,
  type NewPayment,
  type Payment,
} from './payment.types.js';

const GATEWAY_BRAND_NOT_ALLOWED = 'BRAND_NOT_ALLOWED';

export class PaymentService {
  constructor(
    private readonly gateway: PaymentGateway,
    private readonly payments: PaymentRepository,
    private readonly logger: Logger,
  ) {}

  /** Cobra en la pasarela (una sola llamada). Devuelve el transactionId o lanza el AppError que corresponde. */
  async charge(request: ChargeRequest): Promise<{ transactionId: string }> {
    const result = await this.gateway.charge(request);
    switch (result.kind) {
      case 'approved':
        return { transactionId: result.transactionId };
      case 'rejected':
        throw new AppError('PAYMENT_REJECTED');
      case 'cardFlagged':
        throw new AppError('CARD_PROBLEM');
      case 'gatewayError':
        throw new AppError('PAYMENT_GATEWAY_ERROR');
      case 'timeout':
        throw new AppError('PAYMENT_GATEWAY_TIMEOUT');
      case 'invalid':
        if (result.code === GATEWAY_BRAND_NOT_ALLOWED) throw new AppError('CARD_BRAND_NOT_ALLOWED');
        throw new AppError('VALIDATION_ERROR', result.message);
      case 'misconfigured':
        // Error de configuración (API key rechazada): al usuario, un error genérico
        this.logger.error('Payment gateway rejected the API key; check PAYMENT_GATEWAY_API_KEY');
        throw new AppError('INTERNAL_ERROR');
    }
  }

  recordApproved(payment: Omit<NewPayment, 'status'>, executor?: Db): Promise<Payment> {
    return this.payments.create({ ...payment, status: PAYMENT_STATUSES.APPROVED }, executor);
  }

  /** Cobro aprobado que no pudo convertirse en ticket: queda a la espera de un reembolso. */
  recordRefundPending(payment: Omit<NewPayment, 'status'>, executor?: Db): Promise<Payment> {
    return this.payments.create({ ...payment, status: PAYMENT_STATUSES.REFUND_PENDING }, executor);
  }

  markRefundPending(paymentIds: string[], executor: Db): Promise<number> {
    return this.payments.markRefundPending(paymentIds, executor);
  }
}
