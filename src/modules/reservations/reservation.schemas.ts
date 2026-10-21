import { z } from 'zod';
import { SEAT_LABEL_PATTERN } from '../seats/seat-label.js';

// .strict() rechaza cualquier campo extra, incluido `amount`: el monto lo calcula el servidor
export const createReservationSchema = z
  .object({
    eventId: z.uuid(),
    seat: z
      .string()
      .trim()
      .regex(SEAT_LABEL_PATTERN, 'must be a letter A-Z followed by a number 1-10, e.g. C7')
      .transform((label) => label.toUpperCase()),
  })
  .strict();

export const reservationIdParamsSchema = z.object({ id: z.uuid() });

export type CreateReservationBody = z.infer<typeof createReservationSchema>;
export type ReservationIdParams = z.infer<typeof reservationIdParamsSchema>;
