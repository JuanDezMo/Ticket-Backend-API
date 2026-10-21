import { z } from 'zod';
import { paginationSchema } from '../../shared/utils/pagination.js';
import { MAX_CAPACITY } from '../seats/seat.types.js';
import { EVENT_STATUS_VALUES, EVENT_TYPE_VALUES, MAX_PRICE } from './event.types.js';

const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const hasAtMostTwoDecimals = (value: number) =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

/**
 * Schema de creación. Recibe el reloj para poder probar "startDate > ahora"
 * sin depender de la hora real (aquí se usa el reloj del servidor).
 */
export function createEventSchema(now: () => Date) {
  return z
    .object({
      name: z.string().trim().min(1).max(200),
      description: z.string().trim().min(1).max(2000),
      type: z.enum(EVENT_TYPE_VALUES),
      venue: z.string().trim().min(1).max(200),
      price: z
        .number()
        .positive()
        .max(MAX_PRICE)
        .refine(hasAtMostTwoDecimals, 'must have at most 2 decimals'),
      capacity: z.number().int().min(1).max(MAX_CAPACITY),
      startDate: isoDate,
      endDate: isoDate,
    })
    .strict()
    .superRefine((event, ctx) => {
      if (event.startDate <= now()) {
        ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'must be in the future' });
      }
      if (event.endDate <= event.startDate) {
        ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'must be after startDate' });
      }
    });
}

const filtersShape = {
  status: z.enum(EVENT_STATUS_VALUES).optional(),
  type: z.enum(EVENT_TYPE_VALUES).optional(),
  startFrom: isoDate.optional(),
  startTo: isoDate.optional(),
  search: z.string().trim().min(1).max(100).optional(),
};

export const eventFiltersSchema = z
  .object(filtersShape)
  .refine(
    (filters) => !filters.startFrom || !filters.startTo || filters.startFrom <= filters.startTo,
    { path: ['startFrom'], message: 'must not be after startTo' },
  );

// Query del listado: paginación + filtros
export const listEventsQuerySchema = paginationSchema
  .extend(filtersShape)
  .refine((q) => !q.startFrom || !q.startTo || q.startFrom <= q.startTo, {
    path: ['startFrom'],
    message: 'must not be after startTo',
  });

export const eventIdParamsSchema = z.object({ id: z.uuid() });

export type CreateEventBody = z.infer<ReturnType<typeof createEventSchema>>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type EventIdParams = z.infer<typeof eventIdParamsSchema>;
