import { z } from 'zod';
import { SEAT_STATUS_VALUES } from './seat.types.js';

export const eventIdParamsSchema = z.object({ id: z.uuid() });
export const seatsQuerySchema = z.object({ status: z.enum(SEAT_STATUS_VALUES).optional() });

export type SeatsQuery = z.infer<typeof seatsQuerySchema>;
