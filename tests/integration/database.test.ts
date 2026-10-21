import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest } from '../../src/db/migrate.js';
import { migrations } from '../../src/db/migrations/index.js';
import { isUniqueViolation } from '../../src/shared/utils/db-errors.js';
import { createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats, insertReservation, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('database schema', () => {
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

  const insert = (email: string, role = 'USER') =>
    ctx.db.insertInto('users').values({ email, password_hash: 'hash', role }).execute();

  it('applies migrations idempotently', async () => {
    expect(await migrateToLatest(ctx.db)).toEqual([]);
    const tables = await sql<{ table_name: string }>`
      select table_name from information_schema.tables where table_schema = 'public'`.execute(
      ctx.db,
    );
    expect(tables.rows.map((r) => r.table_name)).toContain('users');
  });

  it('rejects a duplicated email with a unique violation', async () => {
    await insert('ana@mail.com');
    await expect(insert('ana@mail.com')).rejects.toSatisfy(isUniqueViolation);
  });

  it('rejects emails that are not lowercase', async () => {
    await expect(insert('Ana@Mail.com')).rejects.toThrow();
  });

  it('rejects an invalid role', async () => {
    await expect(insert('x@mail.com', 'SUPERUSER')).rejects.toThrow();
  });

  describe('reservation status (006)', () => {
    const reservationWith = async (status: string) => {
      const email = `${status.toLowerCase()}@mail.com`;
      const { userId } = await createUserAndLogin(ctx.app, ctx.db, 'USER', email);
      const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
      const seat = await seatOf(ctx.db, event.id, 'A', 1);
      return insertReservation(ctx.db, { userId, eventId: event.id, seatId: seat.id, status });
    };
    const statusOf = async (id: string) =>
      (
        await ctx.db
          .selectFrom('reservations')
          .select('status')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).status;

    it('accepts CANCELLED_BY_USER and rejects an unknown status', async () => {
      expect((await reservationWith('CANCELLED_BY_USER')).status).toBe('CANCELLED_BY_USER');
      await expect(reservationWith('UNKNOWN')).rejects.toThrow();
    });

    it('down turns CANCELLED_BY_USER into CANCELLED, and up applies again', async () => {
      const reservation = await reservationWith('CANCELLED_BY_USER');
      const migrator = new Migrator({
        db: ctx.db,
        provider: { getMigrations: async () => migrations },
      });
      try {
        const { error } = await migrator.migrateTo('005-create-payments-and-tickets');
        expect(error).toBeUndefined();
        expect(await statusOf(reservation.id)).toBe('CANCELLED');
        await expect(
          ctx.db
            .updateTable('reservations')
            .set({ status: 'CANCELLED_BY_USER' })
            .where('id', '=', reservation.id)
            .execute(),
        ).rejects.toThrow();
      } finally {
        expect(await migrateToLatest(ctx.db)).toEqual(['006-add-reservation-cancelled-by-user']);
      }
    });
  });
});
