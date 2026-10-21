import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JwtTokenService } from '../../src/shared/security/token-service.js';

const SECRET = 'a-secret-with-more-than-16-chars';

describe('JwtTokenService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const service = new JwtTokenService(SECRET, 3600);

  it('signs a token with sub, role and expiration', () => {
    const { token, expiresIn } = service.sign({ userId: 'user-1', role: 'ADMIN' });
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    expect(expiresIn).toBe(3600);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('ADMIN');
    expect(decoded.exp! - decoded.iat!).toBe(3600);
    expect(service.verify(token)).toEqual({ userId: 'user-1', role: 'ADMIN' });
  });

  it('rejects a token with an altered signature', () => {
    const { token } = service.sign({ userId: 'user-1', role: 'USER' });
    const [header, payload] = token.split('.');
    expect(service.verify(`${header}.${payload}.invalidsignature`)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const other = new JwtTokenService('another-secret-with-16-chars', 3600);
    expect(service.verify(other.sign({ userId: 'u', role: 'USER' }).token)).toBeNull();
  });

  it('rejects an expired token', () => {
    const { token } = service.sign({ userId: 'user-1', role: 'USER' });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 3600 * 1000);
    expect(service.verify(token)).toBeNull();
  });

  it('rejects tokens with an unknown role or without subject', () => {
    const noSub = jwt.sign({ role: 'USER' }, SECRET);
    const badRole = jwt.sign({ role: 'ROOT' }, SECRET, { subject: 'u' });
    expect(service.verify(noSub)).toBeNull();
    expect(service.verify(badRole)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(service.verify('garbage')).toBeNull();
  });
});
