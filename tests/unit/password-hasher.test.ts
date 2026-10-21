import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '../../src/shared/security/password-hasher.js';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('does not contain the plain password and uses a salt', async () => {
    const a = await hasher.hash('password-123');
    const b = await hasher.hash('password-123');
    expect(a).not.toContain('password-123');
    expect(a).not.toEqual(b);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hasher.hash('password-123');
    expect(await hasher.verify(hash, 'password-123')).toBe(true);
    expect(await hasher.verify(hash, 'other-password')).toBe(false);
  });

  it('returns false for a malformed hash', async () => {
    expect(await hasher.verify('not-a-hash', 'password-123')).toBe(false);
  });
});
