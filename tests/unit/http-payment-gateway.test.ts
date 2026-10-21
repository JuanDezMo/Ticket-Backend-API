import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HttpPaymentGateway } from '../../src/modules/payments/http-payment-gateway.js';
import type { ChargeRequest } from '../../src/modules/payments/payment.types.js';
import type { Logger } from '../../src/shared/logger.js';
import { createLogCapture } from '../helpers/log-capture.js';
import { createLogger } from '../../src/shared/logger.js';
import {
  createGatewayMock,
  GATEWAY_API_KEY,
  GATEWAY_URL,
  gatewayExamples,
} from '../helpers/gateway-mock.js';

const request: ChargeRequest = {
  reservationId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  amount: 150000,
  card: { brand: 'VISA', number: '4111111111111111', expiry: '12/28', cvv: '123' },
};

describe('HttpPaymentGateway', () => {
  const mock = createGatewayMock();
  const capture = createLogCapture();
  const logger: Logger = createLogger('trace', capture.stream);
  const gateway = (timeoutMs = 2000) =>
    new HttpPaymentGateway(GATEWAY_URL, GATEWAY_API_KEY, timeoutMs, logger);

  beforeAll(() => mock.start());
  afterEach(() => {
    mock.reset();
    capture.lines.length = 0;
  });
  afterAll(() => mock.stop());

  it('sends the body and the Bearer header with a single call', async () => {
    await gateway().charge(request);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toEqual({ authorization: `Bearer ${GATEWAY_API_KEY}`, body: request });
  });

  it('accepts a base URL with a trailing slash', async () => {
    await new HttpPaymentGateway(`${GATEWAY_URL}/`, GATEWAY_API_KEY, 2000, logger).charge(request);
    expect(mock.calls).toHaveLength(1);
  });

  it('translates 200 APPROVED into approved with the transactionId', async () => {
    expect(await gateway().charge(request)).toEqual({
      kind: 'approved',
      transactionId: gatewayExamples.approved.transactionId,
    });
  });

  it.each([
    [402, gatewayExamples.rejected, { kind: 'rejected' }],
    [422, gatewayExamples.cardFlagged, { kind: 'cardFlagged' }],
    [502, gatewayExamples.gatewayError, { kind: 'gatewayError' }],
    [401, gatewayExamples.unauthorized, { kind: 'misconfigured' }],
  ])('translates HTTP %i', async (status, body, expected) => {
    mock.respond(status, body);
    expect(await gateway().charge(request)).toEqual(expected);
  });

  it('translates 400 BRAND_NOT_ALLOWED and keeps its code', async () => {
    mock.respond(400, gatewayExamples.brandNotAllowed);
    expect(await gateway().charge(request)).toEqual({
      kind: 'invalid',
      code: 'BRAND_NOT_ALLOWED',
      message: 'Card brand not allowed. Use VISA, MASTERCARD or AMEX',
    });
  });

  it('translates 400 INVALID_REQUEST with the gateway message', async () => {
    mock.respond(400, gatewayExamples.invalidRequest);
    expect(await gateway().charge(request)).toEqual({
      kind: 'invalid',
      code: 'INVALID_REQUEST',
      message: 'Invalid request',
    });
  });

  it.each([
    ['a 500 with a non-JSON body', () => mock.respondText(500, '<html>oops</html>')],
    ['a 200 without transactionId', () => mock.respond(200, { status: 'APPROVED' })],
    [
      'a 200 with another status',
      () => mock.respond(200, { status: 'PENDING', transactionId: 'x' }),
    ],
    ['a 200 with a non-JSON body', () => mock.respondText(200, 'ok')],
    ['an unexpected 418', () => mock.respond(418, {})],
  ])('treats %s as a gateway error', async (_name, arrange) => {
    arrange();
    expect(await gateway().charge(request)).toEqual({ kind: 'gatewayError' });
  });

  it('treats a slow gateway as a timeout', async () => {
    mock.delayedBy(500);
    expect(await gateway(100).charge(request)).toEqual({ kind: 'timeout' });
  });

  it('treats a connection failure as a gateway error, not as a timeout', async () => {
    mock.networkError();
    expect(await gateway().charge(request)).toEqual({ kind: 'gatewayError' });
  });

  it('never leaks the API key or the card data into the logs', async () => {
    for (const arrange of [
      () => mock.networkError(),
      () => mock.respondText(500, 'boom'),
      () => mock.respond(401, gatewayExamples.unauthorized),
    ]) {
      arrange();
      await gateway().charge(request);
    }
    const text = capture.text();
    for (const secret of [GATEWAY_API_KEY, '4111111111111111', '12/28', '"123"']) {
      expect(text).not.toContain(secret);
    }
  });

  it('does not retry on its own', async () => {
    mock.respond(502, gatewayExamples.gatewayError);
    await gateway().charge(request);
    expect(mock.calls).toHaveLength(1);
    vi.useRealTimers();
  });
});
