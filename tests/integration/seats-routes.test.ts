import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUserAndLogin } from '../helpers/auth.js';
import { eventBody, insertEvent } from '../helpers/events.js';
import { createTestContext, type TestContext } from '../helpers/test-app.js';

describe('GET /events/:id/seats', () => {
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

  const createEvent = async (capacity: number) =>
    (
      await request(ctx.app)
        .post('/events')
        .set(...bearer(adminToken))
        .send(eventBody({ capacity }))
    ).body.id as string;

  const list = (eventId: string, query: object = {}, token: string | null = userToken) => {
    const req = request(ctx.app).get(`/events/${eventId}/seats`).query(query);
    if (token) req.set(...bearer(token));
    return req;
  };

  it('returns 20 AVAILABLE seats ordered from A1 to B10 with their label', async () => {
    const id = await createEvent(20);
    const res = await list(id, { status: 'AVAILABLE' });
    expect(res.status).toBe(200);
    expect(res.body.eventId).toBe(id);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.data[0]).toEqual({
      id: expect.any(String),
      row: 'A',
      number: 1,
      label: 'A1',
      status: 'AVAILABLE',
    });
    expect(res.body.data[19]).toMatchObject({ label: 'B10' });
  });

  it('leaves the last row incomplete for a capacity of 25', async () => {
    const id = await createEvent(25);
    const labels = (await list(id)).body.data.map((s: { label: string }) => s.label);
    expect(labels).toHaveLength(25);
    expect(labels.at(-1)).toBe('C5');
  });

  it('returns every status without the filter and only the requested one with it', async () => {
    const id = await createEvent(10);
    await ctx.db
      .updateTable('seats')
      .set({ status: 'SOLD' })
      .where('event_id', '=', id)
      .where('number', '<=', 3)
      .execute();
    expect((await list(id)).body.data).toHaveLength(10);
    expect((await list(id, { status: 'AVAILABLE' })).body.data).toHaveLength(7);
    expect((await list(id, { status: 'SOLD' })).body.data).toHaveLength(3);
  });

  it('returns 400 VALIDATION_ERROR for an invalid status filter', async () => {
    const id = await createEvent(10);
    const res = await list(id, { status: 'FREE' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 EVENT_NOT_FOUND for an unknown event', async () => {
    const res = await list(crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'EVENT_NOT_FOUND', message: 'Event not found' });
  });

  it('returns 400 VALIDATION_ERROR when the id is not a uuid', async () => {
    const res = await list('not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 UNAUTHORIZED without a token', async () => {
    const id = await createEvent(10);
    const res = await list(id, {}, null);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('returns an empty list for AVAILABLE on a cancelled event whose seats are BLOCKED', async () => {
    const event = await insertEvent(ctx.db, { status: 'CANCELLED', capacity: 10 });
    await ctx.db
      .insertInto('seats')
      .values(
        [1, 2, 3].map((number) => ({ event_id: event.id, row: 'A', number, status: 'BLOCKED' })),
      )
      .execute();
    const available = await list(event.id, { status: 'AVAILABLE' });
    expect(available.status).toBe(200);
    expect(available.body.data).toEqual([]);
    expect((await list(event.id, { status: 'BLOCKED' })).body.data).toHaveLength(3);
  });
});
