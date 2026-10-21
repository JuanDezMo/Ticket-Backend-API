import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authenticate } from '../../src/shared/middleware/authenticate.js';
import { errorHandler } from '../../src/shared/middleware/error-handler.js';
import { requireRole } from '../../src/shared/middleware/require-role.js';
import { createLogger } from '../../src/shared/logger.js';
import { JwtTokenService } from '../../src/shared/security/token-service.js';
import { ROLES } from '../../src/shared/security/roles.js';

const tokens = new JwtTokenService('a-secret-with-more-than-16-chars', 3600);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/me', authenticate(tokens), (req, res) => {
    // La identidad sale del token; el userId del cuerpo se ignora
    res.json({ userId: req.auth!.userId, role: req.auth!.role });
  });
  app.get('/admin-only', authenticate(tokens), requireRole(ROLES.ADMIN), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler(createLogger('silent')));
  return app;
}

describe('authenticate', () => {
  it('returns 401 UNAUTHORIZED without the header', async () => {
    const res = await request(buildApp()).post('/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 with a malformed header or a garbage token', async () => {
    const app = buildApp();
    expect((await request(app).post('/me').set('Authorization', 'Basic abc')).status).toBe(401);
    expect((await request(app).post('/me').set('Authorization', 'Bearer garbage')).status).toBe(
      401,
    );
  });

  it('uses the identity from the token and not from the body', async () => {
    const { token } = tokens.sign({ userId: 'real-user', role: 'USER' });
    const res = await request(buildApp())
      .post('/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'someone-else', role: 'ADMIN' });
    expect(res.body).toEqual({ userId: 'real-user', role: 'USER' });
  });
});

describe('requireRole', () => {
  it('returns 403 FORBIDDEN for a USER and passes for an ADMIN', async () => {
    const app = buildApp();
    const user = tokens.sign({ userId: 'u', role: 'USER' }).token;
    const admin = tokens.sign({ userId: 'a', role: 'ADMIN' }).token;

    const forbidden = await request(app).get('/admin-only').set('Authorization', `Bearer ${user}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');

    const ok = await request(app).get('/admin-only').set('Authorization', `Bearer ${admin}`);
    expect(ok.status).toBe(200);
  });
});
