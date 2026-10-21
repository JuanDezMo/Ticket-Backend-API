import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const GATEWAY_URL = 'http://payment-gateway.test';
export const GATEWAY_API_KEY = 'test-gateway-key';

/** Respuestas de ejemplo tomadas del openapi.json de la pasarela. */
export const gatewayExamples = {
  approved: { status: 'APPROVED', transactionId: '3f2b8c0e-6a1d-4e55-9a57-0d1c2b3a4f5e' },
  invalidRequest: { status: 'INVALID', code: 'INVALID_REQUEST', message: 'Invalid request' },
  brandNotAllowed: {
    status: 'INVALID',
    code: 'BRAND_NOT_ALLOWED',
    message: 'Card brand not allowed. Use VISA, MASTERCARD or AMEX',
  },
  unauthorized: {
    status: 'UNAUTHORIZED',
    code: 'INVALID_API_KEY',
    message: 'Invalid or missing API key',
  },
  rejected: { status: 'REJECTED', code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds' },
  cardFlagged: {
    status: 'CARD_FLAGGED',
    code: 'CARD_PROBLEM',
    message: 'The card has problems, use another payment method',
  },
  gatewayError: {
    status: 'ERROR',
    code: 'GATEWAY_ERROR',
    message: 'Error processing the payment, please try again',
  },
};

export interface GatewayCall {
  authorization: string | null;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

type Behavior = (call: GatewayCall) => Response | Promise<Response>;

/**
 * Simula la pasarela con MSW. Cada test elige la respuesta y puede inspeccionar las llamadas
 * recibidas (por ejemplo, para comprobar que fue exactamente una o que no hubo ninguna).
 */
export function createGatewayMock() {
  const calls: GatewayCall[] = [];
  let behavior: Behavior = () => HttpResponse.json(gatewayExamples.approved);

  const server = setupServer(
    http.post(`${GATEWAY_URL}/payments`, async ({ request }) => {
      const call: GatewayCall = {
        authorization: request.headers.get('authorization'),
        body: await request.json(),
      };
      calls.push(call);
      return behavior(call);
    }),
  );

  return {
    calls,
    start: () => server.listen({ onUnhandledFrame: 'bypass' }),
    stop: () => server.close(),
    reset: () => {
      calls.length = 0;
      behavior = () => HttpResponse.json(gatewayExamples.approved);
    },
    respond: (status: number, body: unknown) => {
      behavior = () => HttpResponse.json(body as Record<string, unknown>, { status });
    },
    respondText: (status: number, text: string) => {
      behavior = () => new HttpResponse(text, { status });
    },
    respondWith: (fn: Behavior) => {
      behavior = fn;
    },
    delayedBy: (ms: number) => {
      behavior = async () => {
        await delay(ms);
        return HttpResponse.json(gatewayExamples.approved);
      };
    },
    networkError: () => {
      behavior = () => HttpResponse.error();
    },
  };
}
