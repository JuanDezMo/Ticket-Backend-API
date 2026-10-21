import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { eventBody, futureDate, insertEvent } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('events routes', () => {
  let ctx: TestContext;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    adminToken = (await createUserAndLogin(ctx.app, ctx.db, 'ADMIN')).token;
    userToken = (await createUserAndLogin(ctx.app, ctx.db, 'USER')).token;
  });

  const create = (token: string | undefined, body: object) => {
    const req = request(ctx.app).post('/events');
    if (token) req.set(...bearer(token));
    return req.send(body);
  };

  describe('POST /events', () => {
    it('lets an ADMIN create an event with system-assigned status and createdAt', async () => {
      const res = await create(adminToken, eventBody());
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        name: 'Rock Night',
        description: 'A great concert',
        type: 'CONCERT',
        venue: 'Main Hall',
        price: 150000,
        capacity: 20,
        startDate: expect.any(String),
        endDate: expect.any(String),
        createdAt: expect.any(String),
        status: 'ACTIVE',
      });
    });

    it('supports different capacities per event', async () => {
      const small = await create(adminToken, eventBody({ capacity: 20 }));
      const big = await create(adminToken, eventBody({ name: 'Big', capacity: 100 }));
      expect(small.body.capacity).toBe(20);
      expect(big.body.capacity).toBe(100);
      const count = async (id: string) =>
        (await ctx.db.selectFrom('seats').select('id').where('event_id', '=', id).execute()).length;
      expect(await count(small.body.id)).toBe(20);
      expect(await count(big.body.id)).toBe(100);
    });

    it('returns 403 FORBIDDEN for a USER and creates nothing', async () => {
      const res = await create(userToken, eventBody());
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(await ctx.db.selectFrom('events').selectAll().execute()).toHaveLength(0);
    });

    it('returns 401 UNAUTHORIZED without a token', async () => {
      const res = await create(undefined, eventBody());
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it.each([
      ['an invalid type', { type: 'FESTIVAL' }],
      ['a zero price', { price: 0 }],
      ['capacity 0', { capacity: 0 }],
      ['capacity 261', { capacity: 261 }],
      [
        'a start date in the past',
        { startDate: '2020-01-01T00:00:00Z', endDate: '2020-01-02T00:00:00Z' },
      ],
      ['an end date before the start', { endDate: futureDate(1) }],
      ['a missing name', { name: undefined }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_name, override) => {
      const res = await create(adminToken, eventBody(override));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(await ctx.db.selectFrom('events').selectAll().execute()).toHaveLength(0);
    });

    it('does not expose any operation to modify an event', async () => {
      const { body } = await create(adminToken, eventBody());
      for (const method of ['put', 'patch', 'delete'] as const) {
        const agent = request(ctx.app);
        const res = await agent[method](`/events/${body.id}`).set(...bearer(adminToken));
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('GET /events', () => {
    it('is public and returns { data, meta }', async () => {
      await insertEvent(ctx.db, { name: 'A' });
      const res = await request(ctx.app).get('/events');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    });

    it('returns an empty list with total 0 when there are no events', async () => {
      const res = await request(ctx.app).get('/events');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [],
        meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      });
    });

    it('shows cancelled events with their status', async () => {
      await insertEvent(ctx.db, { name: 'Cancelled one', status: 'CANCELLED' });
      const res = await request(ctx.app).get('/events');
      expect(res.body.data[0]).toMatchObject({ name: 'Cancelled one', status: 'CANCELLED' });
    });

    it('paginates 45 events: 20 / 20 / 5, with no repeats or gaps', async () => {
      for (let i = 0; i < 45; i++) {
        await insertEvent(ctx.db, {
          name: `Event ${i}`,
          start_date: futureDate(1 + Math.floor(i / 3)),
          end_date: futureDate(1 + Math.floor(i / 3), 23),
        });
      }
      const pages = [];
      for (const page of [1, 2, 3]) {
        pages.push(await request(ctx.app).get('/events').query({ page, pageSize: 20 }));
      }
      expect(pages.map((p) => p.body.data.length)).toEqual([20, 20, 5]);
      expect(pages[0]!.body.meta).toEqual({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
      const ids = pages.flatMap((p) => p.body.data.map((e: { id: string }) => e.id));
      expect(new Set(ids).size).toBe(45);

      const outOfRange = await request(ctx.app).get('/events').query({ page: 10 });
      expect(outOfRange.status).toBe(200);
      expect(outOfRange.body.data).toEqual([]);
      expect(outOfRange.body.meta.total).toBe(45);
    });

    it('applies filters and combines them with AND', async () => {
      await insertEvent(ctx.db, {
        name: 'Rock Night',
        type: 'CONCERT',
        start_date: futureDate(10),
        end_date: futureDate(10, 23),
      });
      await insertEvent(ctx.db, {
        name: 'Dev Meetup',
        type: 'MEETUP',
        start_date: futureDate(20),
        end_date: futureDate(20, 23),
      });
      await insertEvent(ctx.db, {
        name: 'Old Meetup',
        type: 'MEETUP',
        status: 'CANCELLED',
        start_date: futureDate(60),
        end_date: futureDate(60, 23),
      });

      const byType = await request(ctx.app).get('/events').query({ type: 'CONCERT' });
      expect(byType.body.data.map((e: { name: string }) => e.name)).toEqual(['Rock Night']);
      expect(byType.body.meta.total).toBe(1);

      const byStatus = await request(ctx.app).get('/events').query({ status: 'CANCELLED' });
      expect(byStatus.body.data.map((e: { name: string }) => e.name)).toEqual(['Old Meetup']);

      const combined = await request(ctx.app)
        .get('/events')
        .query({ type: 'MEETUP', startFrom: futureDate(15), startTo: futureDate(30) });
      expect(combined.body.data.map((e: { name: string }) => e.name)).toEqual(['Dev Meetup']);

      const search = await request(ctx.app).get('/events').query({ search: 'rock' });
      expect(search.body.data.map((e: { name: string }) => e.name)).toEqual(['Rock Night']);
    });

    it.each([
      ['pageSize 21', { pageSize: 21 }],
      ['pageSize 0', { pageSize: 0 }],
      ['page 0', { page: 0 }],
      ['an invalid type', { type: 'FESTIVAL' }],
      ['an inverted date range', { startFrom: futureDate(30), startTo: futureDate(10) }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_name, query) => {
      const res = await request(ctx.app).get('/events').query(query);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /events/:id', () => {
    it('is public and returns the same body as the listing', async () => {
      const { id } = await insertEvent(ctx.db, { name: 'Detail' });
      const res = await request(ctx.app).get(`/events/${id}`);
      expect(res.status).toBe(200);
      const listed = (await request(ctx.app).get('/events')).body.data.find(
        (e: { id: string }) => e.id === id,
      );
      expect(res.body).toEqual(listed);
    });

    it('returns a cancelled event with its status', async () => {
      const { id } = await insertEvent(ctx.db, { status: 'CANCELLED' });
      const res = await request(ctx.app).get(`/events/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('returns 404 EVENT_NOT_FOUND for an unknown id', async () => {
      const res = await request(ctx.app).get(`/events/${crypto.randomUUID()}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ code: 'EVENT_NOT_FOUND', message: expect.any(String) });
    });

    it('returns 400 VALIDATION_ERROR when the id is not a UUID', async () => {
      const res = await request(ctx.app).get('/events/abc');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('also responds with a USER or ADMIN token', async () => {
      const { id } = await insertEvent(ctx.db);
      for (const token of [userToken, adminToken]) {
        const res = await request(ctx.app).get(`/events/${id}`).set(...bearer(token));
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(id);
      }
    });
  });
});
