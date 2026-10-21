import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import type { CancellationStep } from '../../src/modules/cancellations/cancellation-step.js';
import { CancellationService } from '../../src/modules/cancellations/cancellation.service.js';
import { BlockSeatsStep } from '../../src/modules/cancellations/steps/block-seats.step.js';
import { KyselyEventRepository } from '../../src/modules/events/event.repository.js';
import { EventService } from '../../src/modules/events/event.service.js';
import { KyselySeatRepository } from '../../src/modules/seats/seat.repository.js';
import { SeatService } from '../../src/modules/seats/seat.service.js';
import { createUserAndLogin } from '../helpers/auth.js';
import { insertEventWithSeats, insertReservation, seatOf } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('cancellation atomicity', () => {
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

  it('rolls everything back when the reservations step fails after the seats were blocked', async () => {
    await createUserAndLogin(ctx.app, ctx.db, 'USER');
    const userId = (await ctx.db.selectFrom('users').select('id').executeTakeFirstOrThrow()).id;
    const event = await insertEventWithSeats(ctx.db, { capacity: 10 });
    await insertReservation(ctx.db, {
      userId,
      eventId: event.id,
      seatId: (await seatOf(ctx.db, event.id, 'A', 1)).id,
    });

    const seats = new SeatService(new KyselySeatRepository(ctx.db));
    const failingStep: CancellationStep = {
      name: 'reservations',
      execute: async (_eventId: string, _trx: Db) => {
        throw new Error('reservations step failed');
      },
    };
    const service = new CancellationService(
      new EventService(new KyselyEventRepository(ctx.db), seats, ctx.db),
      [new BlockSeatsStep(seats), failingStep],
      ctx.db,
    );

    await expect(service.cancel(event.id)).rejects.toThrow('reservations step failed');

    const row = await ctx.db
      .selectFrom('events')
      .select('status')
      .where('id', '=', event.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('ACTIVE');
    expect((await seatOf(ctx.db, event.id, 'A', 1)).status).toBe('RESERVED');
    expect((await seatOf(ctx.db, event.id, 'A', 2)).status).toBe('AVAILABLE');
    const reservation = await ctx.db
      .selectFrom('reservations')
      .select('status')
      .executeTakeFirstOrThrow();
    expect(reservation.status).toBe('ACTIVE');
  });
});
