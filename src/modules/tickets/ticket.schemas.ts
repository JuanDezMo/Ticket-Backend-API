import { z } from 'zod';
import { MAX_SEATS_PER_USER } from '../events/event.types.js';

// La franquicia llega como `unknown` a propósito: se valida aparte (parseCardBrand) para devolver
// los errores específicos CARD_BRAND_REQUIRED / CARD_BRAND_NOT_ALLOWED. El formato del número,
// el vencimiento y el CVV lo valida la pasarela; aquí solo se exige que estén presentes.
// .strict() rechaza cualquier campo extra, incluidos `amount` y el antiguo `reservationId`: el
// monto lo calcula el servidor y la compra siempre recibe una lista de reservas.
const RESERVATION_IDS_MESSAGE = `must be a list of 1 to ${MAX_SEATS_PER_USER} different reservation ids`;

export const purchaseSchema = z
  .object({
    reservationIds: z
      .array(z.uuid(), {
        error: (issue) => (issue.input === undefined ? 'is required' : RESERVATION_IDS_MESSAGE),
      })
      .min(1, RESERVATION_IDS_MESSAGE)
      .max(MAX_SEATS_PER_USER, RESERVATION_IDS_MESSAGE)
      .refine((ids) => new Set(ids).size === ids.length, RESERVATION_IDS_MESSAGE),
    card: z
      .object({
        brand: z.unknown().optional(),
        number: z.string().trim().min(1),
        expiry: z.string().trim().min(1),
        cvv: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export type PurchaseBody = z.infer<typeof purchaseSchema>;
