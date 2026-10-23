import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/database.js';
import type { PaymentGateway } from '../../src/modules/payments/payment-gateway.js';
import type { PaymentRepository } from '../../src/modules/payments/payment.repository.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import type { ChargeRequest, GatewayResult } from '../../src/modules/payments/payment.types.js';
import type { Logger } from '../../src/shared/logger.js';

const request: ChargeRequest = {
  reservationId: 'res-1',
  amount: 100,
  card: { brand: 'VISA', number: '4111111111111111', expiry: '12/28', cvv: '123' },
};

function build(result: GatewayResult) {
  const gateway: PaymentGateway = { charge: vi.fn().mockResolvedValue(result) };
  const repo = {
    create: vi.fn().mockImplementation(async (p) => ({ id: 'pay-1', createdAt: new Date(), ...p })),
    markRefundPending: vi.fn().mockResolvedValue(2),
    existsByTransactionId: vi.fn().mockResolvedValue(false),
  } satisfies PaymentRepository;
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Logger & {
    error: ReturnType<typeof vi.fn>;
  };
  return { service: new PaymentService(gateway, repo, logger), gateway, repo, logger };
}

describe('PaymentService.charge', () => {
  it('returns the transactionId when approved', async () => {
    const { service, gateway } = build({ kind: 'approved', transactionId: 'txn-1' });
    expect(await service.charge(request)).toEqual({ transactionId: 'txn-1' });
    expect(gateway.charge).toHaveBeenCalledTimes(1);
    expect(gateway.charge).toHaveBeenCalledWith(request);
  });

  it.each([
    [{ kind: 'rejected' }, 'PAYMENT_REJECTED', 402],
    [{ kind: 'cardFlagged' }, 'CARD_PROBLEM', 422],
    [{ kind: 'gatewayError' }, 'PAYMENT_GATEWAY_ERROR', 502],
    [{ kind: 'timeout' }, 'PAYMENT_GATEWAY_TIMEOUT', 504],
    [{ kind: 'invalid', code: 'BRAND_NOT_ALLOWED', message: 'x' }, 'CARD_BRAND_NOT_ALLOWED', 400],
    [
      { kind: 'invalid', code: 'INVALID_REQUEST', message: 'Invalid request' },
      'VALIDATION_ERROR',
      400,
    ],
    [{ kind: 'misconfigured' }, 'INTERNAL_ERROR', 500],
  ] as [GatewayResult, string, number][])(
    'translates %j to %s (%i)',
    async (result, code, status) => {
      const { service } = build(result);
      await expect(service.charge(request)).rejects.toMatchObject({ code, status });
    },
  );

  it('keeps the gateway message for invalid card data', async () => {
    const { service } = build({
      kind: 'invalid',
      code: 'INVALID_REQUEST',
      message: 'expiry: invalid',
    });
    await expect(service.charge(request)).rejects.toMatchObject({ message: 'expiry: invalid' });
  });

  it('logs the incident without secrets and hides it from the user when the API key is rejected', async () => {
    const { service, logger } = build({ kind: 'misconfigured' });
    await expect(service.charge(request)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('4111');
  });
});

describe('PaymentService records', () => {
  const payment = { orderId: 'o', transactionId: 't', amount: 10 };

  it('records APPROVED and REFUND_PENDING payments', async () => {
    const { service, repo } = build({ kind: 'rejected' });
    const trx = {} as Db;
    await service.recordApproved(payment, trx);
    await service.recordRefundPending(payment, trx);
    expect(repo.create).toHaveBeenNthCalledWith(1, { ...payment, status: 'APPROVED' }, trx);
    expect(repo.create).toHaveBeenNthCalledWith(2, { ...payment, status: 'REFUND_PENDING' }, trx);
  });

  it('delegates markRefundPending', async () => {
    const { service, repo } = build({ kind: 'rejected' });
    const trx = {} as Db;
    expect(await service.markRefundPending(['a', 'b'], trx)).toBe(2);
    expect(repo.markRefundPending).toHaveBeenCalledWith(['a', 'b'], trx);
  });
});
