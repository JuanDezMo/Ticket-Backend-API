import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KyselyTicketRepository } from '../../src/modules/tickets/ticket.repository.js';
import { createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats, seatOf } from '../helpers/events.js';
import { insertTicket } from '../helpers/purchase.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('KyselyTicketRepository', () => {
  let ctx: TestContext;
  let repo: KyselyTicketRepository;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    repo = new KyselyTicketRepository(ctx.db);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    await createUserAndLogin(ctx.app, ctx.db, 'USER');
    userId = (await ctx.db.selectFrom('users').select('id').executeTakeFirstOrThrow()).id;
  });

  const seat = async (eventId: string, n: number) => (await seatOf(ctx.db, eventId, 'A', n)).id;

  it('finds a ticket by reservation with its seat label and transaction id', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const t = await insertTicket(ctx.db, {
      userId,
      eventId: event.id,
      seatId: await seat(event.id, 3),
    });
    const reservationId = (
      await ctx.db
        .selectFrom('tickets')
        .select('reservation_id')
        .where('id', '=', t.id)
        .executeTakeFirstOrThrow()
    ).reservation_id;

    const found = await repo.findByReservation(reservationId);
    expect(found).toMatchObject({
      id: t.id,
      seat: 'A3',
      status: 'ISSUED',
      amount: 100,
      userId,
      eventId: event.id,
    });
    expect(found?.transactionId).toMatch(/^txn-/);
    expect(await repo.findByReservation(crypto.randomUUID())).toBeNull();
  });

  it('lists only the tickets of the user, newest first, with the event data and a total', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 10, name: 'Rock Night' });
    await createUserAndLogin(ctx.app, ctx.db, 'USER', 'other@mail.com');
    const other = (
      await ctx.db
        .selectFrom('users')
        .select('id')
        .where('email', '=', 'other@mail.com')
        .executeTakeFirstOrThrow()
    ).id;
    const old = await insertTicket(ctx.db, {
      userId,
      eventId: event.id,
      seatId: await seat(event.id, 1),
      issuedAt: new Date('2026-01-01T10:00:00Z'),
    });
    const recent = await insertTicket(ctx.db, {
      userId,
      eventId: event.id,
      seatId: await seat(event.id, 2),
      issuedAt: new Date('2026-02-01T10:00:00Z'),
    });
    await insertTicket(ctx.db, {
      userId: other,
      eventId: event.id,
      seatId: await seat(event.id, 3),
    });

    const { items, total } = await repo.listByUser(userId, { page: 1, pageSize: 20 });
    expect(total).toBe(2);
    expect(items.map((i) => i.id)).toEqual([recent.id, old.id]);
    expect(items[0]).toMatchObject({
      seat: 'A2',
      status: 'ISSUED',
      event: { id: event.id, name: 'Rock Night', venue: 'Venue' },
    });
  });

  it('paginates and returns an empty page out of range', async () => {
    const event = await insertEventWithSeats(ctx.db, { capacity: 30 });
    for (let n = 1; n <= 10; n++) {
      await insertTicket(ctx.db, {
        userId,
        eventId: event.id,
        seatId: await seat(event.id, n),
        issuedAt: new Date(Date.now() - n * 1000),
      });
    }
    const page2 = await repo.listByUser(userId, { page: 2, pageSize: 4 });
    expect(page2.items).toHaveLength(4);
    expect(page2.total).toBe(10);
    expect((await repo.listByUser(userId, { page: 9, pageSize: 4 })).items).toEqual([]);
  });

  it('cancelByEvent moves only ISSUED tickets of that event and returns their payment ids', async () => {
    const a = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const b = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const t1 = await insertTicket(ctx.db, { userId, eventId: a.id, seatId: await seat(a.id, 1) });
    await insertTicket(ctx.db, { userId, eventId: a.id, seatId: await seat(a.id, 2) });
    await insertTicket(ctx.db, {
      userId,
      eventId: a.id,
      seatId: await seat(a.id, 3),
      status: 'CANCELLED_BY_EVENT',
    });
    const tb = await insertTicket(ctx.db, { userId, eventId: b.id, seatId: await seat(b.id, 1) });

    const paymentIds = await repo.cancelByEvent(a.id, ctx.db);
    expect(paymentIds).toHaveLength(2);
    const statuses = await ctx.db.selectFrom('tickets').select(['id', 'status']).execute();
    expect(statuses.find((s) => s.id === t1.id)?.status).toBe('CANCELLED_BY_EVENT');
    expect(statuses.find((s) => s.id === tb.id)?.status).toBe('ISSUED');
    expect(await repo.cancelByEvent(a.id, ctx.db)).toEqual([]);
  });
});
