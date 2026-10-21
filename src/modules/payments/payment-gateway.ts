import type { ChargeRequest, GatewayResult } from './payment.types.js';

/** Abstracción de la pasarela de pagos externa; permite sustituirla (por ejemplo en pruebas). */
export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<GatewayResult>;
}
