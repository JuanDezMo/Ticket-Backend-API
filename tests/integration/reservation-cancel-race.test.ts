import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats } from '../helpers/events.js';
import { reserveSeat } from '../helpers/purchase.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('reservation cancellation races', () => {
  let ctx: TestContext;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    adminToken = (await createUserAndLogin(ctx.app, ctx.db, 'ADMIN')).token;
  });

  const cancel = (token: string, id: string) =>
    request(ctx.app)
      .post(`/reservations/${id}/cancel`)
      .set(...bearer(token));

  it.each([1, 2, 3, 4, 5])(
    'owners cancelling while the ADMIN cancels the event never deadlock (round %i)',
    async (round) => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 20 });
      const owners = [];
      for (let i = 0; i < 6; i++) {
        owners.push(
          await reserveSeat(ctx.app, ctx.db, {
            email: `r${round}u${i}@mail.com`,
            seat: `A${i + 1}`,
            eventId: event.id,
          }),
        );
      }

      const results = await Promise.all([
        ...owners.map((o) => cancel(o.token, o.reservation.id)),
        request(ctx.app)
          .post(`/events/${event.id}/cancel`)
          .set(...bearer(adminToken)),
      ]);

      expect(results.filter((r) => r.status >= 500)).toEqual([]);
      expect(results[results.length - 1]!.status).toBe(200);

      const seats = await ctx.db
        .selectFrom('seats')
        .select('status')
        .where('event_id', '=', event.id)
        .execute();
      expect(seats.every((s) => s.status === 'BLOCKED')).toBe(true);

      for (const [i, owner] of owners.entries()) {
        const res = results[i]!;
        const { status } = await ctx.db
          .selectFrom('reservations')
          .select('status')
          .where('id', '=', owner.reservation.id)
          .executeTakeFirstOrThrow();
        if (res.status === 200) {
          expect(status).toBe('CANCELLED_BY_USER');
        } else {
          expect(res.status).toBe(409);
          expect(res.body.code).toBe('EVENT_CANCELLED');
          expect(status).toBe('CANCELLED');
        }
      }
    },
  );

  it('two simultaneous cancellations of the same reservation: one 200 and one 409', async () => {
    const { token, reservation } = await reserveSeat(ctx.app, ctx.db);
    const results = await Promise.all([
      cancel(token, reservation.id),
      cancel(token, reservation.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('RESERVATION_ALREADY_CANCELLED');
  });
});
