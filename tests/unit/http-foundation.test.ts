import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/shared/errors/index.js';
import { errorHandler, notFoundHandler } from '../../src/shared/middleware/error-handler.js';
import { validate } from '../../src/shared/middleware/validate.js';
import type { Logger } from '../../src/shared/logger.js';

function buildApp() {
  const logger = { error: vi.fn() } as unknown as Logger;
  const app = express();
  app.use(express.json());
  app.post('/items', validate(z.object({ name: z.string().min(1) }).strict()), (req, res) => {
    res.status(201).json(req.body);
  });
  app.get('/boom', () => {
    throw new Error('connection to db failed: password=super-secret at /srv/app/db.ts:10');
  });
  app.get('/known', () => {
    throw new AppError('EMAIL_ALREADY_EXISTS');
  });
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return { app, logger };
}

describe('error handling', () => {
  it('returns a generic 500 and does not leak internals', async () => {
    const { app, logger } = buildApp();
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('super-secret');
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('serializes known errors as { code, message }', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/known');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: 'EMAIL_ALREADY_EXISTS', message: 'Email already exists' });
  });

  it('returns 404 NOT_FOUND for unknown routes', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('validate middleware', () => {
  it('accepts a valid body', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/items').send({ name: 'ok' });
    expect(res.status).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for an invalid body', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/items').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toContain('name');
  });

  it('rejects unknown fields', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/items').send({ name: 'ok', role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/items')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
