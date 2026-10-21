import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { expireReservations, insertEventWithSeats, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ReservationExpiryJob (real timer, 1 s interval)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext({ RESERVATION_EXPIRY_INTERVAL_SECONDS: '1' });
  });
  afterAll(async () => {
    ctx.container.reservationExpiryJob.stop();
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  it('frees an expired reservation of an event nobody is querying', async () => {
    const token = (await createUserAndLogin(ctx.app, ctx.db, 'USER')).token;
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    const reserved = await request(ctx.app)
      .post('/reservations')
      .set(...bearer(token))
      .send({ eventId: event.id, seat: 'A1' });
    await expireReservations(ctx.db, reserved.body.seatId);

    ctx.container.reservationExpiryJob.start();
    await sleep(2500); // al menos una ejecución del job

    const reservation = await ctx.db
      .selectFrom('reservations')
      .select('status')
      .where('id', '=', reserved.body.id)
      .executeTakeFirstOrThrow();
    expect(reservation.status).toBe('EXPIRED');
    expect((await seatOf(ctx.db, event.id, 'A', 1)).status).toBe('AVAILABLE');
  });
});
