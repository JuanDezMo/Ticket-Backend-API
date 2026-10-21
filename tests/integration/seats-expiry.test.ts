import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { expireReservations, insertEventWithSeats } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('GET /events/:id/seats releases expired reservations', () => {
  let ctx: TestContext;
  let userToken: string;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    userToken = (await createUserAndLogin(ctx.app, ctx.db, 'USER')).token;
    eventId = (await insertEventWithSeats(ctx.db, { capacity: 10 })).id;
  });

  const reserve = (seat: string) =>
    request(ctx.app)
      .post('/reservations')
      .set(...bearer(userToken))
      .send({ eventId, seat });
  const list = (status: string) =>
    request(ctx.app)
      .get(`/events/${eventId}/seats`)
      .query({ status })
      .set(...bearer(userToken));
  const labels = (res: request.Response) => res.body.data.map((s: { label: string }) => s.label);

  it('shows a seat with an expired reservation as AVAILABLE and expires the reservation', async () => {
    const reserved = await reserve('A1');
    await expireReservations(ctx.db, reserved.body.seatId);

    const available = await list('AVAILABLE');
    expect(labels(available)).toContain('A1');
    const row = await ctx.db
      .selectFrom('reservations')
      .select('status')
      .where('id', '=', reserved.body.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('EXPIRED');
  });

  it('keeps a seat with a live reservation as RESERVED and out of the AVAILABLE list', async () => {
    await reserve('A1');
    expect(labels(await list('AVAILABLE'))).not.toContain('A1');
    expect(labels(await list('RESERVED'))).toEqual(['A1']);
  });

  it('only releases reservations of the requested event', async () => {
    const other = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const mine = await reserve('A1');
    const theirs = await request(ctx.app)
      .post('/reservations')
      .set(...bearer(userToken))
      .send({ eventId: other.id, seat: 'A1' });
    await expireReservations(ctx.db);

    await list('AVAILABLE'); // solo libera el evento consultado
    const rows = await ctx.db.selectFrom('reservations').select(['id', 'status']).execute();
    expect(rows.find((r) => r.id === mine.body.id)?.status).toBe('EXPIRED');
    expect(rows.find((r) => r.id === theirs.body.id)?.status).toBe('ACTIVE');
  });
});
