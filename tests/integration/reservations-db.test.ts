import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../../src/shared/utils/db-errors.js';
import { createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('reservations schema', () => {
  let ctx: TestContext;
  let userId: string;
  let eventId: string;
  let seatId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    await createUserAndLogin(ctx.app, ctx.db, 'USER');
    userId = (await ctx.db.selectFrom('users').select('id').executeTakeFirstOrThrow()).id;
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    eventId = event.id;
    seatId = (await seatOf(ctx.db, eventId, 'A', 1)).id;
  });

  const insert = (status = 'ACTIVE', seat = seatId) =>
    ctx.db
      .insertInto('reservations')
      .values({
        user_id: userId,
        seat_id: seat,
        event_id: eventId,
        amount: 100,
        status,
        expires_at: new Date(Date.now() + 600_000),
      })
      .execute();

  it('rejects a second ACTIVE reservation for the same seat', async () => {
    await insert();
    await expect(insert()).rejects.toSatisfy(isUniqueViolation);
  });

  it('allows a new ACTIVE reservation once the previous one is EXPIRED or CANCELLED', async () => {
    await insert('EXPIRED');
    await insert('CANCELLED');
    await expect(insert('ACTIVE')).resolves.toBeDefined();
  });

  it('allows ACTIVE reservations on different seats', async () => {
    await insert('ACTIVE', seatId);
    await expect(
      insert('ACTIVE', (await seatOf(ctx.db, eventId, 'A', 2)).id),
    ).resolves.toBeDefined();
  });

  it('rejects an invalid status', async () => {
    await expect(insert('PENDING')).rejects.toThrow();
  });

  it('deletes reservations in cascade with their event', async () => {
    await insert();
    await ctx.db.deleteFrom('events').execute();
    expect(await ctx.db.selectFrom('reservations').selectAll().execute()).toHaveLength(0);
  });

  it('has the partial indexes used to count the holds of a user', async () => {
    const rows = await sql<{ indexname: string; indexdef: string }>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'reservations'
        AND indexname IN ('reservations_user_event_hold_idx', 'reservations_user_active_idx')
    `.execute(ctx.db);
    const byName = Object.fromEntries(rows.rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName['reservations_user_event_hold_idx']).toMatch(/\(user_id, event_id\)/);
    expect(byName['reservations_user_event_hold_idx']).toMatch(/ACTIVE.*CONFIRMED/);
    expect(byName['reservations_user_active_idx']).toMatch(/\(user_id\)/);
    expect(byName['reservations_user_active_idx']).toMatch(/status = 'ACTIVE'/);
  });
});
