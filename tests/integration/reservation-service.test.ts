import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KyselyEventRepository } from '../../src/modules/events/event.repository.js';
import { EventService } from '../../src/modules/events/event.service.js';
import { KyselyReservationRepository } from '../../src/modules/reservations/reservation.repository.js';
import { ReservationService } from '../../src/modules/reservations/reservation.service.js';
import { KyselySeatRepository } from '../../src/modules/seats/seat.repository.js';
import { SeatService } from '../../src/modules/seats/seat.service.js';
import { createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('ReservationService transaction', () => {
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

  it('puts the seat back to AVAILABLE and leaves no reservation when the insert fails', async () => {
    await createUserAndLogin(ctx.app, ctx.db, 'USER');
    const userId = (await ctx.db.selectFrom('users').select('id').executeTakeFirstOrThrow()).id;
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });

    class FailingRepository extends KyselyReservationRepository {
      override async createMany(): Promise<never> {
        throw new Error('insert failed');
      }
    }
    const seats = new SeatService(new KyselySeatRepository(ctx.db));
    const service = new ReservationService(
      new FailingRepository(ctx.db),
      seats,
      new EventService(new KyselyEventRepository(ctx.db), seats, ctx.db),
      ctx.db,
      10,
      8,
    );

    await expect(service.create(userId, { eventId: event.id, seats: ['A1'] })).rejects.toThrow(
      'insert failed',
    );
    expect((await seatOf(ctx.db, event.id, 'A', 1)).status).toBe('AVAILABLE');
    expect(await ctx.db.selectFrom('reservations').selectAll().execute()).toHaveLength(0);
  });
});
