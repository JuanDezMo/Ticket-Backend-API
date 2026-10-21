import { z } from 'zod';

// La franquicia llega como `unknown` a propósito: se valida aparte (parseCardBrand) para devolver
// los errores específicos CARD_BRAND_REQUIRED / CARD_BRAND_NOT_ALLOWED. El formato del número,
// el vencimiento y el CVV lo valida la pasarela; aquí solo se exige que estén presentes.
// .strict() rechaza cualquier campo extra, incluido `amount`: el monto lo calcula el servidor.
export const purchaseSchema = z
  .object({
    reservationId: z.uuid(),
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
