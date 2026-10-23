import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('cancellation concurrency', () => {
  let ctx: TestContext;
  let adminToken: string;
  let userTokens: string[];

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    adminToken = (await createUserAndLogin(ctx.app, ctx.db, 'ADMIN')).token;
    userTokens = [];
    for (let i = 0; i < 6; i++) {
      userTokens.push((await createUserAndLogin(ctx.app, ctx.db, 'USER', `u${i}@mail.com`)).token);
    }
  });

  const cancel = (id: string) =>
    request(ctx.app)
      .post(`/events/${id}/cancel`)
      .set(...bearer(adminToken));
  const reserve = (token: string, eventId: string, seat: string) =>
    request(ctx.app)
      .post('/reservations')
      .set(...bearer(token))
      .send({ eventId, seats: [seat] });

  it('lets exactly one of several simultaneous cancellations succeed', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const results = await Promise.all(Array.from({ length: 5 }, () => cancel(event.id)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const conflicts = results.filter((r) => r.status === 409);
    expect(conflicts).toHaveLength(4);
    expect(conflicts.every((r) => r.body.code === 'EVENT_ALREADY_CANCELLED')).toBe(true);
  });

  it.each([1, 2, 3, 4, 5])(
    'never leaves an ACTIVE reservation or a RESERVED seat on a cancelled event (round %i)',
    async () => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 20 });
      const seats = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];

      const results = await Promise.all([
        ...userTokens.map((token, i) => reserve(token, event.id, seats[i]!)),
        cancel(event.id),
        ...userTokens.map((token, i) => reserve(token, event.id, `B${i + 1}`)),
      ]);

      // Ninguna solicitud puede terminar en error del servidor (por ejemplo un deadlock)
      expect(results.filter((r) => r.status >= 500)).toEqual([]);
      const cancellation = results[userTokens.length]!;
      expect(cancellation.status).toBe(200);

      const row = await ctx.db
        .selectFrom('events')
        .select('status')
        .where('id', '=', event.id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('CANCELLED');
      const active = await ctx.db
        .selectFrom('reservations')
        .selectAll()
        .where('event_id', '=', event.id)
        .where('status', '=', 'ACTIVE')
        .execute();
      expect(active).toEqual([]);
      const reserved = await ctx.db
        .selectFrom('seats')
        .selectAll()
        .where('event_id', '=', event.id)
        .where('status', '=', 'RESERVED')
        .execute();
      expect(reserved).toEqual([]);
      // las reservas hechas antes de la cancelación quedaron CANCELLED y se contaron
      const cancelled = await ctx.db
        .selectFrom('reservations')
        .selectAll()
        .where('event_id', '=', event.id)
        .where('status', '=', 'CANCELLED')
        .execute();
      expect(cancellation.body.cancelledReservations).toBe(cancelled.length);
    },
  );
});
