import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KyselySeatRepository } from '../../src/modules/seats/seat.repository.js';
import { insertEventWithSeats, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('KyselySeatRepository reservation support', () => {
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

  it('finds a seat only inside its own event', async () => {
    const a = await insertEventWithSeats(ctx.db, { capacity: 20 });
    const b = await insertEventWithSeats(ctx.db, { capacity: 10 });
    expect(await repo.findByEventAndPosition(a.id, { row: 'B', number: 3 })).toMatchObject({
      eventId: a.id,
      row: 'B',
      number: 3,
    });
    // B3 existe en el evento A pero no en el B (capacidad 10)
    expect(await repo.findByEventAndPosition(b.id, { row: 'B', number: 3 })).toBeNull();
    expect(
      await repo.findByEventAndPosition(crypto.randomUUID(), { row: 'A', number: 1 }),
    ).toBeNull();
  });

  it('moves an AVAILABLE seat to RESERVED', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const seat = await seatOf(ctx.db, event.id, 'A', 1);
    expect(await repo.markReserved(seat.id)).toBe(true);
    expect((await seatOf(ctx.db, event.id, 'A', 1)).status).toBe('RESERVED');
  });

  it.each(['RESERVED', 'SOLD', 'BLOCKED'])('does not change a %s seat', async (status) => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const seat = await seatOf(ctx.db, event.id, 'A', 1);
    await ctx.db.updateTable('seats').set({ status }).where('id', '=', seat.id).execute();
    expect(await repo.markReserved(seat.id)).toBe(false);
    expect((await seatOf(ctx.db, event.id, 'A', 1)).status).toBe(status);
  });

  it('returns false for an unknown seat', async () => {
    expect(await repo.markReserved(crypto.randomUUID())).toBe(false);
  });
});
