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
});
