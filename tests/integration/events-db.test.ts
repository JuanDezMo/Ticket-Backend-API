import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../../src/shared/utils/db-errors.js';
import { insertEvent } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('events and seats schema', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  it('rejects a capacity outside 1..260', async () => {
    await expect(insertEvent(ctx.db, { capacity: 0 })).rejects.toThrow();
    await expect(insertEvent(ctx.db, { capacity: 261 })).rejects.toThrow();
    await expect(insertEvent(ctx.db, { capacity: 260 })).resolves.toBeDefined();
  });

  it('accepts the limit per user at its bounds (1 and 8)', async () => {
    const min = await insertEvent(ctx.db, { capacity: 10, max_seats_per_user: 1 });
    const max = await insertEvent(ctx.db, { capacity: 10, max_seats_per_user: 8 });
    expect([min.max_seats_per_user, max.max_seats_per_user]).toEqual([1, 8]);
  });

  it('rejects a limit of 0, 9, null or greater than the capacity', async () => {
    await expect(insertEvent(ctx.db, { capacity: 10, max_seats_per_user: 0 })).rejects.toThrow();
    await expect(insertEvent(ctx.db, { capacity: 20, max_seats_per_user: 9 })).rejects.toThrow();
    await expect(insertEvent(ctx.db, { capacity: 4, max_seats_per_user: 5 })).rejects.toThrow();
    await expect(
      ctx.db
        .insertInto('events')
        .values({
          name: 'No limit',
          description: 'd',
          type: 'CONCERT',
          venue: 'v',
          price: 100,
          capacity: 10,
          start_date: new Date(Date.now() + 86_400_000),
          end_date: new Date(Date.now() + 90_000_000),
        } as never)
        .execute(),
    ).rejects.toThrow();
  });

  it('accepts a limit equal to the capacity', async () => {
    await expect(
      insertEvent(ctx.db, { capacity: 4, max_seats_per_user: 4 }),
    ).resolves.toBeDefined();
    await expect(
      insertEvent(ctx.db, { capacity: 1, max_seats_per_user: 1 }),
    ).resolves.toBeDefined();
  });

  it('rejects an invalid type, status or dates', async () => {
    await expect(insertEvent(ctx.db, { type: 'FESTIVAL' })).rejects.toThrow();
    await expect(insertEvent(ctx.db, { status: 'DELETED' })).rejects.toThrow();
    await expect(
      insertEvent(ctx.db, { start_date: '2030-01-02T00:00:00Z', end_date: '2030-01-01T00:00:00Z' }),
    ).rejects.toThrow();
  });

  it('rejects a duplicated seat for the same event but allows it in another event', async () => {
    const a = await insertEvent(ctx.db);
    const b = await insertEvent(ctx.db);
    const seat = (eventId: string) =>
      ctx.db.insertInto('seats').values({ event_id: eventId, row: 'A', number: 1 }).execute();

    await seat(a.id);
    await expect(seat(a.id)).rejects.toSatisfy(isUniqueViolation);
    await expect(seat(b.id)).resolves.toBeDefined();
  });

  it('rejects an invalid seat status and a seat without event', async () => {
    const event = await insertEvent(ctx.db);
    await expect(
      ctx.db
        .insertInto('seats')
        .values({ event_id: event.id, row: 'A', number: 1, status: 'FREE' })
        .execute(),
    ).rejects.toThrow();
    await expect(
      ctx.db
        .insertInto('seats')
        .values({ event_id: crypto.randomUUID(), row: 'A', number: 1 })
        .execute(),
    ).rejects.toThrow();
  });
});
