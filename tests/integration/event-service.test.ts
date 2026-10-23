import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KyselyEventRepository } from '../../src/modules/events/event.repository.js';
import { EventService } from '../../src/modules/events/event.service.js';
import { KyselySeatRepository } from '../../src/modules/seats/seat.repository.js';
import { SeatService } from '../../src/modules/seats/seat.service.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

const input = {
  name: 'Rock Night',
  description: 'desc',
  type: 'CONCERT' as const,
  venue: 'Hall',
  price: 150000,
  capacity: 25,
  maxSeatsPerUser: 4,
  startDate: new Date(Date.now() + 86_400_000),
  endDate: new Date(Date.now() + 90_000_000),
};

describe('EventService.create (transaction)', () => {
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

  it('creates the event with exactly `capacity` AVAILABLE seats', async () => {
    const service = new EventService(
      new KyselyEventRepository(ctx.db),
      new SeatService(new KyselySeatRepository(ctx.db)),
      ctx.db,
    );
    const event = await service.create(input);

    const seats = await ctx.db
      .selectFrom('seats')
      .selectAll()
      .where('event_id', '=', event.id)
      .execute();
    expect(seats).toHaveLength(25);
    expect(seats.every((s) => s.status === 'AVAILABLE')).toBe(true);
    expect(event.status).toBe('ACTIVE');
  });

  it('leaves no event and no orphan seats when seat creation fails', async () => {
    class FailingSeatService extends SeatService {
      override async generateForEvent(...args: Parameters<SeatService['generateForEvent']>) {
        // Inserta una parte y luego falla: debe deshacerse todo
        await super.generateForEvent(args[0], 5, args[2]);
        throw new Error('seat generation failed');
      }
    }
    const service = new EventService(
      new KyselyEventRepository(ctx.db),
      new FailingSeatService(new KyselySeatRepository(ctx.db)),
      ctx.db,
    );

    await expect(service.create(input)).rejects.toThrow('seat generation failed');
    expect(await ctx.db.selectFrom('events').selectAll().execute()).toHaveLength(0);
    expect(await ctx.db.selectFrom('seats').selectAll().execute()).toHaveLength(0);
  });

  it('getById throws EVENT_NOT_FOUND for an unknown id', async () => {
    const service = new EventService(
      new KyselyEventRepository(ctx.db),
      new SeatService(new KyselySeatRepository(ctx.db)),
      ctx.db,
    );
    await expect(service.getById(crypto.randomUUID())).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
      status: 404,
    });
  });
});
