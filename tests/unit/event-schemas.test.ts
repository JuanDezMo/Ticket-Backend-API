import { describe, expect, it } from 'vitest';
import {
  createEventSchema,
  eventFiltersSchema,
  eventIdParamsSchema,
  listEventsQuerySchema,
} from '../../src/modules/events/event.schemas.js';

const NOW = new Date('2026-01-01T00:00:00Z');
const schema = createEventSchema(() => NOW);

const valid = {
  name: 'Rock Night',
  description: 'desc',
  type: 'CONCERT',
  venue: 'Hall',
  price: 150000,
  capacity: 20,
  maxSeatsPerUser: 4,
  startDate: '2026-02-01T20:00:00Z',
  endDate: '2026-02-01T23:00:00Z',
};

describe('createEventSchema', () => {
  it('accepts a valid event and converts dates', () => {
    const parsed = schema.parse(valid);
    expect(parsed.startDate).toBeInstanceOf(Date);
    expect(parsed.capacity).toBe(20);
  });

  it.each([
    ['empty name', { name: '' }],
    ['empty description', { description: '  ' }],
    ['empty venue', { venue: '' }],
    ['unknown type', { type: 'FESTIVAL' }],
    ['zero price', { price: 0 }],
    ['negative price', { price: -5 }],
    ['price with 3 decimals', { price: 10.123 }],
    ['capacity 0', { capacity: 0 }],
    ['capacity 261', { capacity: 261 }],
    ['non-integer capacity', { capacity: 10.5 }],
    ['start date in the past', { startDate: '2025-12-31T23:59:59Z' }],
    ['start date equal to now', { startDate: '2026-01-01T00:00:00Z' }],
    ['end date before start', { endDate: '2026-02-01T19:00:00Z' }],
    ['end date equal to start', { endDate: '2026-02-01T20:00:00Z' }],
    ['non ISO date', { startDate: '01/02/2026' }],
    ['unknown field', { status: 'CANCELLED' }],
  ])('rejects %s', (_name, override) => {
    expect(schema.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it('accepts capacity 1 and 260 and a price with 2 decimals', () => {
    // Con capacidad 1 el límite por usuario solo puede ser 1
    expect(schema.safeParse({ ...valid, capacity: 1, maxSeatsPerUser: 1 }).success).toBe(true);
    expect(schema.safeParse({ ...valid, capacity: 260 }).success).toBe(true);
    expect(schema.safeParse({ ...valid, price: 19.99 }).success).toBe(true);
  });
});

describe('createEventSchema: maxSeatsPerUser', () => {
  const messageOf = (override: Record<string, unknown>) => {
    const result = schema.safeParse({ ...valid, ...override });
    return result.success
      ? null
      : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };

  it.each([1, 8])('accepts the limit value %i', (value) => {
    expect(schema.safeParse({ ...valid, maxSeatsPerUser: value }).success).toBe(true);
  });

  it.each([0, 9, -1, 2.5])('rejects %s as out of range', (value) => {
    expect(messageOf({ maxSeatsPerUser: value })).toEqual([
      'maxSeatsPerUser: must be an integer from 1 to 8',
    ]);
  });

  it('rejects a text value', () => {
    expect(messageOf({ maxSeatsPerUser: '4' })).toEqual([
      'maxSeatsPerUser: must be an integer from 1 to 8',
    ]);
  });

  it('says the field is required when it is missing or null-like', () => {
    const withoutLimit = { ...valid, maxSeatsPerUser: undefined };
    const result = schema.safeParse(withoutLimit);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([
      'maxSeatsPerUser: is required',
    ]);
  });

  it('rejects a limit greater than the capacity and accepts it equal', () => {
    expect(messageOf({ capacity: 4, maxSeatsPerUser: 5 })).toEqual([
      'maxSeatsPerUser: must not exceed capacity',
    ]);
    expect(schema.safeParse({ ...valid, capacity: 4, maxSeatsPerUser: 4 }).success).toBe(true);
    expect(schema.safeParse({ ...valid, capacity: 1, maxSeatsPerUser: 1 }).success).toBe(true);
  });

  it('accepts the maximum limit with a capacity of at least 8', () => {
    expect(schema.safeParse({ ...valid, capacity: 8, maxSeatsPerUser: 8 }).success).toBe(true);
    expect(schema.safeParse({ ...valid, capacity: 260, maxSeatsPerUser: 8 }).success).toBe(true);
  });
});

describe('eventFiltersSchema', () => {
  it('accepts every valid filter', () => {
    const parsed = eventFiltersSchema.parse({
      status: 'CANCELLED',
      type: 'MEETUP',
      startFrom: '2026-01-01T00:00:00Z',
      startTo: '2026-12-31T00:00:00Z',
      search: 'rock',
    });
    expect(parsed.startFrom).toBeInstanceOf(Date);
    expect(parsed.search).toBe('rock');
  });

  it('accepts no filters', () => {
    expect(eventFiltersSchema.parse({})).toEqual({});
  });

  it.each([
    ['unknown status', { status: 'DELETED' }],
    ['unknown type', { type: 'FESTIVAL' }],
    ['invalid date', { startFrom: 'yesterday' }],
    ['empty search', { search: '' }],
    ['inverted range', { startFrom: '2026-12-31T00:00:00Z', startTo: '2026-01-01T00:00:00Z' }],
  ])('rejects %s', (_name, value) => {
    expect(eventFiltersSchema.safeParse(value).success).toBe(false);
  });

  it('accepts startFrom equal to startTo', () => {
    const d = '2026-06-01T00:00:00Z';
    expect(eventFiltersSchema.safeParse({ startFrom: d, startTo: d }).success).toBe(true);
  });
});

describe('listEventsQuerySchema', () => {
  it('combines pagination defaults with filters', () => {
    expect(listEventsQuerySchema.parse({ type: 'CONCERT' })).toEqual({
      page: 1,
      pageSize: 20,
      type: 'CONCERT',
    });
  });

  it('rejects pageSize 21 and an inverted range', () => {
    expect(listEventsQuerySchema.safeParse({ pageSize: '21' }).success).toBe(false);
    expect(
      listEventsQuerySchema.safeParse({
        startFrom: '2026-12-31T00:00:00Z',
        startTo: '2026-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});

describe('eventIdParamsSchema', () => {
  it('accepts a UUID', () => {
    const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    expect(eventIdParamsSchema.parse({ id })).toEqual({ id });
  });

  it('rejects an id that is not a UUID', () => {
    expect(eventIdParamsSchema.safeParse({ id: 'abc' }).success).toBe(false);
  });
});
