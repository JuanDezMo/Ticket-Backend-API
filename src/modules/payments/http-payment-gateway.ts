import type { Logger } from '../../shared/logger.js';
import type { PaymentGateway } from './payment-gateway.js';
import type { ChargeRequest, GatewayResult } from './payment.types.js';

interface GatewayBody {
  status?: unknown;
  transactionId?: unknown;
  code?: unknown;
  message?: unknown;
}

/**
 * Cliente HTTP de la pasarela (contrato en payment-gateway-microservice-project/docs/openapi.json).
 * Una sola llamada por intento, sin reintentos automáticos, con tiempo límite.
 * Nunca registra el cuerpo de la solicitud ni la API key.
 */
export class HttpPaymentGateway implements PaymentGateway {
  private readonly url: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
  ) {
    this.url = `${baseUrl.replace(/\/+$/, '')}/payments`;
  }

  async charge(request: ChargeRequest): Promise<GatewayResult> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        return { kind: 'timeout' };
      }
      // Solo el tipo del error: nada del contenido de la solicitud
      this.logger.warn({ errorName: (error as Error)?.name }, 'Payment gateway is unreachable');
      return { kind: 'gatewayError' };
    }
    return this.translate(response);
  }

  private async translate(response: Response): Promise<GatewayResult> {
    const body = await this.readBody(response);
    switch (response.status) {
      case 200:
        return body?.status === 'APPROVED' &&
          typeof body.transactionId === 'string' &&
          body.transactionId !== ''
          ? { kind: 'approved', transactionId: body.transactionId }
          : this.unexpected(response.status);
      case 402:
        return { kind: 'rejected' };
      case 422:
        return { kind: 'cardFlagged' };
      case 502:
        return { kind: 'gatewayError' };
      case 400: {
        const code = typeof body?.code === 'string' ? body.code : 'INVALID_REQUEST';
        const message = typeof body?.message === 'string' ? body.message : 'Invalid request';
        return { kind: 'invalid', code, message };
      }
      case 401:
        return { kind: 'misconfigured' };
      default:
        return this.unexpected(response.status);
    }
  }

  private unexpected(status: number): GatewayResult {
    this.logger.warn({ status }, 'Unexpected response from the payment gateway');
    return { kind: 'gatewayError' };
  }

  private async readBody(response: Response): Promise<GatewayBody | null> {
    try {
      const parsed: unknown = await response.json();
      return typeof parsed === 'object' && parsed !== null ? (parsed as GatewayBody) : null;
    } catch {
      return null;
    }
  }
}
