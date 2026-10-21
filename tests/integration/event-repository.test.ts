import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KyselyEventRepository } from '../../src/modules/events/event.repository.js';
import { futureDate, insertEvent } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

const PAGE = { page: 1, pageSize: 20 };

describe('KyselyEventRepository.list', () => {
  let ctx: TestContext;
  let repo: KyselyEventRepository;

  beforeAll(async () => {
    ctx = await createTestContext();
    repo = new KyselyEventRepository(ctx.db);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    await insertEvent(ctx.db, {
      name: 'Rock Night',
      type: 'CONCERT',
      start_date: futureDate(10),
      end_date: futureDate(10, 23),
    });
    await insertEvent(ctx.db, {
      name: 'Jazz Evening',
      type: 'CONCERT',
      start_date: futureDate(20),
      end_date: futureDate(20, 23),
    });
    await insertEvent(ctx.db, {
      name: 'Dev Meetup',
      type: 'MEETUP',
      start_date: futureDate(30),
      end_date: futureDate(30, 23),
    });
    await insertEvent(ctx.db, {
      name: '100% Sure_Event',
      type: 'OTHER',
      status: 'CANCELLED',
      start_date: futureDate(40),
      end_date: futureDate(40, 23),
    });
  });

  it('lists events of every status ordered by start date', async () => {
    const { items, total } = await repo.list({}, PAGE);
    expect(total).toBe(4);
    expect(items.map((e) => e.name)).toEqual([
      'Rock Night',
      'Jazz Evening',
      'Dev Meetup',
      '100% Sure_Event',
    ]);
    expect(items[0]?.price).toBe(100);
  });

  it('filters by status, type and search, and counts only filtered rows', async () => {
    expect((await repo.list({ status: 'CANCELLED' }, PAGE)).total).toBe(1);
    expect((await repo.list({ type: 'CONCERT' }, PAGE)).total).toBe(2);
    const search = await repo.list({ search: 'ROCK' }, PAGE);
    expect(search.items.map((e) => e.name)).toEqual(['Rock Night']);
  });

  it('treats LIKE wildcards in the search as plain text', async () => {
    expect((await repo.list({ search: '%' }, PAGE)).items.map((e) => e.name)).toEqual([
      '100% Sure_Event',
    ]);
    expect((await repo.list({ search: '_' }, PAGE)).items.map((e) => e.name)).toEqual([
      '100% Sure_Event',
    ]);
    expect((await repo.list({ search: 'Zzz' }, PAGE)).total).toBe(0);
  });

  it('filters by date range (inclusive) and combines filters with AND', async () => {
    const range = await repo.list(
      { startFrom: new Date(futureDate(15)), startTo: new Date(futureDate(35)) },
      PAGE,
    );
    expect(range.items.map((e) => e.name)).toEqual(['Jazz Evening', 'Dev Meetup']);
    const combined = await repo.list(
      { type: 'CONCERT', startFrom: new Date(futureDate(15)), startTo: new Date(futureDate(35)) },
      PAGE,
    );
    expect(combined.items.map((e) => e.name)).toEqual(['Jazz Evening']);
    expect(combined.total).toBe(1);
  });

  it('paginates with a stable order and a total independent of the page', async () => {
    const first = await repo.list({}, { page: 1, pageSize: 3 });
    const second = await repo.list({}, { page: 2, pageSize: 3 });
    const outOfRange = await repo.list({}, { page: 9, pageSize: 3 });
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(1);
    expect(first.total).toBe(4);
    expect(second.total).toBe(4);
    expect(outOfRange.items).toEqual([]);
    expect(new Set([...first.items, ...second.items].map((e) => e.id)).size).toBe(4);
  });

  it('breaks ties by id so pages never repeat or skip events', async () => {
    await ctx.reset();
    const sameStart = futureDate(5);
    for (let i = 0; i < 5; i++) {
      await insertEvent(ctx.db, {
        name: `Tie ${i}`,
        start_date: sameStart,
        end_date: futureDate(5, 23),
      });
    }
    const pages = await Promise.all([1, 2, 3].map((page) => repo.list({}, { page, pageSize: 2 })));
    const ids = pages.flatMap((p) => p.items.map((e) => e.id));
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });
});
