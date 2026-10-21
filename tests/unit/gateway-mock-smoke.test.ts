import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGatewayMock, GATEWAY_URL, gatewayExamples } from '../helpers/gateway-mock.js';

describe('gateway mock (msw)', () => {
  const gateway = createGatewayMock();
  beforeAll(() => gateway.start());
  afterEach(() => gateway.reset());
  afterAll(() => gateway.stop());

  it('answers with the approved example and records the call', async () => {
    const res = await fetch(`${GATEWAY_URL}/payments`, {
      method: 'POST',
      headers: { Authorization: 'Bearer k' },
      body: JSON.stringify({ reservationId: 'r' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(gatewayExamples.approved);
    expect(gateway.calls).toEqual([{ authorization: 'Bearer k', body: { reservationId: 'r' } }]);
  });

  it('can answer with another status and fail the network', async () => {
    gateway.respond(402, gatewayExamples.rejected);
    expect((await fetch(`${GATEWAY_URL}/payments`, { method: 'POST', body: '{}' })).status).toBe(
      402,
    );
    gateway.networkError();
    await expect(
      fetch(`${GATEWAY_URL}/payments`, { method: 'POST', body: '{}' }),
    ).rejects.toThrow();
  });
});
