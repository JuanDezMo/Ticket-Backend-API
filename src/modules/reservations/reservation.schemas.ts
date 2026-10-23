import { z } from 'zod';
import { MAX_SEATS_PER_USER } from '../events/event.types.js';
import { SEAT_LABEL_PATTERN } from '../seats/seat-label.js';

// .strict() rechaza cualquier campo extra, incluido `amount`: el monto lo calcula el servidor
export const createReservationSchema = z
  .object({
    eventId: z.uuid(),
    // Las etiquetas se normalizan a mayúscula antes de comprobar que no haya repetidas ("C5" y "c5")
    seats: z
      .array(
        z
          .string()
          .trim()
          .regex(SEAT_LABEL_PATTERN, 'must be a letter A-Z followed by a number 1-10, e.g. C7')
          .transform((label) => label.toUpperCase()),
      )
      .min(1)
      .max(MAX_SEATS_PER_USER)
      .refine((labels) => new Set(labels).size === labels.length, 'must not repeat seats'),
  })
  .strict();

export const reservationIdParamsSchema = z.object({ id: z.uuid() });

export type CreateReservationBody = z.infer<typeof createReservationSchema>;
export type ReservationIdParams = z.infer<typeof reservationIdParamsSchema>;
