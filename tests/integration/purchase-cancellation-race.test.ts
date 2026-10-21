import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats } from '../helpers/events.js';
import { createGatewayMock } from '../helpers/gateway-mock.js';
import { purchaseBody, reserveSeat } from '../helpers/purchase.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('purchase versus event cancellation race', () => {
  const gateway = createGatewayMock();
  let ctx: TestContext;
  let adminToken: string;

  beforeAll(async () => {
    gateway.start();
    ctx = await createTestContext();
  });
  afterAll(async () => {
    gateway.stop();
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    adminToken = (await createUserAndLogin(ctx.app, ctx.db, 'ADMIN')).token;
  });
  afterEach(() => gateway.reset());

  it.each([1, 2, 3, 4, 5])(
    'is always consistent: no ISSUED ticket on a cancelled event and every charge accounted for (round %i)',
    async (round) => {
      const event = await insertEventWithSeats(ctx.db, { capacity: 20 });
      const buyers = [];
      for (let i = 0; i < 6; i++) {
        buyers.push(
          await reserveSeat(ctx.app, ctx.db, {
            email: `r${round}u${i}@mail.com`,
            seat: `A${i + 1}`,
            eventId: event.id,
          }),
        );
      }
      let n = 0;
      gateway.respondWith(async () => {
        const { HttpResponse } = await import('msw');
        return HttpResponse.json({ status: 'APPROVED', transactionId: `txn-${round}-${++n}` });
      });

      const results = await Promise.all([
        ...buyers.map((b) =>
          request(ctx.app)
            .post('/tickets/purchase')
            .set(...bearer(b.token))
            .send(purchaseBody(b.reservation.id)),
        ),
        request(ctx.app)
          .post(`/events/${event.id}/cancel`)
          .set(...bearer(adminToken)),
      ]);

      expect(results.filter((r) => r.status >= 500)).toEqual([]);
      const cancellation = results[results.length - 1]!;
      expect(cancellation.status).toBe(200);
      for (const r of results.slice(0, -1)) {
        expect([201, 409]).toContain(r.status);
        if (r.status === 409) expect(r.body.code).toBe('EVENT_CANCELLED');
      }

      const row = await ctx.db
        .selectFrom('events')
        .select('status')
        .where('id', '=', event.id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('CANCELLED');
      const tickets = await ctx.db
        .selectFrom('tickets')
        .selectAll()
        .where('event_id', '=', event.id)
        .execute();
      expect(tickets.filter((t) => t.status === 'ISSUED')).toEqual([]);
      const payments = await ctx.db
        .selectFrom('payments')
        .selectAll()
        .where('event_id', '=', event.id)
        .execute();
      expect(payments.filter((p) => p.status === 'APPROVED')).toEqual([]);
      // cada cobro aprobado por la pasarela quedó registrado
      expect(payments).toHaveLength(n);
      // los pagos con ticket coinciden con tickets cancelados
      expect(tickets.length).toBe(results.slice(0, -1).filter((r) => r.status === 201).length);
      expect(cancellation.body.cancelledTickets).toBe(tickets.length);
      const active = await ctx.db
        .selectFrom('reservations')
        .selectAll()
        .where('event_id', '=', event.id)
        .where('status', '=', 'ACTIVE')
        .execute();
      expect(active).toEqual([]);
    },
  );
});
