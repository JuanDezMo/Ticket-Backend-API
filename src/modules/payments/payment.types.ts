export const CARD_BRANDS = { VISA: 'VISA', MASTERCARD: 'MASTERCARD', AMEX: 'AMEX' } as const;

export type CardBrand = (typeof CARD_BRANDS)[keyof typeof CARD_BRANDS];
export const CARD_BRAND_VALUES = Object.values(CARD_BRANDS) as CardBrand[];

export const PAYMENT_STATUSES = { APPROVED: 'APPROVED', REFUND_PENDING: 'REFUND_PENDING' } as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

/** Datos de tarjeta: solo viajan hacia la pasarela, nunca se guardan ni se registran. */
export interface CardData {
  brand: CardBrand;
  number: string;
  expiry: string;
  cvv: string;
}

export interface ChargeRequest {
  reservationId: string;
  amount: number;
  card: CardData;
}

/** Resultado interno de una llamada a la pasarela (traducción de su contrato HTTP). */
export type GatewayResult =
  | { kind: 'approved'; transactionId: string }
  | { kind: 'rejected' }
  | { kind: 'cardFlagged' }
  | { kind: 'gatewayError' }
  | { kind: 'invalid'; code: string; message: string }
  | { kind: 'misconfigured' }
  | { kind: 'timeout' };

export interface NewPayment {
  reservationId: string;
  userId: string;
  eventId: string;
  transactionId: string;
  amount: number;
  status: PaymentStatus;
}

export interface Payment extends NewPayment {
  id: string;
  createdAt: Date;
}
