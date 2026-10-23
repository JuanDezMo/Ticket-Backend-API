import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateSeatLayout } from '../../src/modules/seats/seat-layout.js';
import { KyselySeatRepository } from '../../src/modules/seats/seat.repository.js';
import { insertEvent } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('KyselySeatRepository', () => {
  let ctx: TestContext;
  let repo: KyselySeatRepository;

  beforeAll(async () => {
    ctx = await createTestContext();
    repo = new KyselySeatRepository(ctx.db);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  it('inserts 260 seats in one statement, ordered by row and number', async () => {
    const event = await insertEvent(ctx.db, { capacity: 260 });
    await repo.insertMany(event.id, generateSeatLayout(260));

    const seats = await repo.findByEvent(event.id);
    expect(seats).toHaveLength(260);
    expect(seats[0]).toMatchObject({ row: 'A', number: 1, status: 'AVAILABLE' });
    expect(seats[9]).toMatchObject({ row: 'A', number: 10 });
    expect(seats[10]).toMatchObject({ row: 'B', number: 1 });
    expect(seats.at(-1)).toMatchObject({ row: 'Z', number: 10 });
  });

  it('filters by status and by event', async () => {
    const a = await insertEvent(ctx.db);
    const b = await insertEvent(ctx.db);
    await repo.insertMany(a.id, generateSeatLayout(3));
    await repo.insertMany(b.id, generateSeatLayout(2));
    await ctx.db
      .updateTable('seats')
      .set({ status: 'SOLD' })
      .where('event_id', '=', a.id)
      .where('number', '=', 2)
      .execute();

    expect(await repo.findByEvent(a.id, 'AVAILABLE')).toHaveLength(2);
    expect(await repo.findByEvent(a.id, 'SOLD')).toHaveLength(1);
    expect(await repo.findByEvent(b.id)).toHaveLength(2);
  });

  it('does nothing when there are no positions', async () => {
    const event = await insertEvent(ctx.db);
    await expect(repo.insertMany(event.id, [])).resolves.toBeUndefined();
  });

  describe('operations for reserving several seats', () => {
    const positions = [
      { row: 'A', number: 3 },
      { row: 'B', number: 1 },
      { row: 'A', number: 1 },
    ];

    it('finds several seats of one event in a single query and ignores the missing ones', async () => {
      const event = await insertEvent(ctx.db, { capacity: 20 });
      const other = await insertEvent(ctx.db, { capacity: 20 });
      await repo.insertMany(event.id, generateSeatLayout(15));
      await repo.insertMany(other.id, generateSeatLayout(20));

      const found = await repo.findByEventAndPositions(event.id, [
        ...positions,
        { row: 'B', number: 10 },
      ]);

      // B10 no existe en un evento de 15 seats
      expect(found.map((seat) => `${seat.row}${seat.number}`).sort()).toEqual(['A1', 'A3', 'B1']);
      expect(found.every((seat) => seat.eventId === event.id)).toBe(true);
    });

    it('returns an empty list for no positions', async () => {
      const event = await insertEvent(ctx.db);
      expect(await repo.findByEventAndPositions(event.id, [])).toEqual([]);
    });

    it('locks the seats in ascending id order whatever order they are requested in', async () => {
      const event = await insertEvent(ctx.db, { capacity: 10 });
      await repo.insertMany(event.id, generateSeatLayout(10));
      const all = await repo.findByEvent(event.id);
      const requested = all.map((seat) => seat.id).reverse();

      const locked = await ctx.db.transaction().execute((trx) => repo.lockByIds(requested, trx));

      const ids = locked.map((seat) => seat.id);
      expect(ids).toEqual([...ids].sort());
      expect(ids).toHaveLength(10);
    });

    it('marks several seats as RESERVED at once and leaves the occupied ones alone', async () => {
      const event = await insertEvent(ctx.db, { capacity: 10 });
      await repo.insertMany(event.id, generateSeatLayout(10));
      const [a, b, c] = await repo.findByEvent(event.id);
      await ctx.db.updateTable('seats').set({ status: 'SOLD' }).where('id', '=', c!.id).execute();

      const changed = await ctx.db
        .transaction()
        .execute((trx) => repo.markReservedMany([a!.id, b!.id, c!.id], trx));

      expect(changed).toBe(2);
      const after = await repo.findByEvent(event.id);
      expect(after.slice(0, 3).map((seat) => seat.status)).toEqual([
        'RESERVED',
        'RESERVED',
        'SOLD',
      ]);
    });

    it('marks 8 seats at once', async () => {
      const event = await insertEvent(ctx.db, { capacity: 10 });
      await repo.insertMany(event.id, generateSeatLayout(10));
      const eight = (await repo.findByEvent(event.id)).slice(0, 8).map((seat) => seat.id);

      const changed = await ctx.db
        .transaction()
        .execute((trx) => repo.markReservedMany(eight, trx));

      expect(changed).toBe(8);
    });
  });
});
