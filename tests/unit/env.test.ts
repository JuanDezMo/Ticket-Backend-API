import { describe, expect, it } from 'vitest';
import { ConfigError, loadEnv } from '../../src/config/env.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_SECRET: 'a-secret-with-more-than-16-chars',
};

describe('loadEnv', () => {
  it('loads defaults when only the required variables are present', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.JWT_EXPIRES_IN_SECONDS).toBe(3600);
    expect(env.SEED_ADMIN_EMAIL).toBeUndefined();
  });

  it('fails naming JWT_SECRET when it is missing', () => {
    expect(() => loadEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrowError(/JWT_SECRET/);
  });

  it('fails naming DATABASE_URL when it is missing', () => {
    try {
      loadEnv({ JWT_SECRET: valid.JWT_SECRET });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).variables).toEqual(['DATABASE_URL']);
    }
  });

  it('does not fail when the seed variables are missing', () => {
    expect(() => loadEnv(valid)).not.toThrow();
  });

  it('treats empty seed variables as not defined', () => {
    const env = loadEnv({ ...valid, SEED_ADMIN_EMAIL: '', SEED_ADMIN_PASSWORD: '' });
    expect(env.SEED_ADMIN_EMAIL).toBeUndefined();
    expect(env.SEED_ADMIN_PASSWORD).toBeUndefined();
  });

  it('defaults the reservation TTL to 10 minutes and the expiry job to 60 seconds', () => {
    const env = loadEnv(valid);
    expect(env.RESERVATION_TTL_MINUTES).toBe(10);
    expect(env.RESERVATION_EXPIRY_INTERVAL_SECONDS).toBe(60);
  });

  it('accepts custom reservation settings', () => {
    const env = loadEnv({
      ...valid,
      RESERVATION_TTL_MINUTES: '3',
      RESERVATION_EXPIRY_INTERVAL_SECONDS: '1',
    });
    expect(env.RESERVATION_TTL_MINUTES).toBe(3);
    expect(env.RESERVATION_EXPIRY_INTERVAL_SECONDS).toBe(1);
  });

  it.each(['0', '-5', 'abc', '1.5'])('rejects reservation TTL %j', (value) => {
    expect(() => loadEnv({ ...valid, RESERVATION_TTL_MINUTES: value })).toThrowError(
      /RESERVATION_TTL_MINUTES/,
    );
  });

  it.each(['0', 'abc'])('rejects expiry interval %j', (value) => {
    expect(() => loadEnv({ ...valid, RESERVATION_EXPIRY_INTERVAL_SECONDS: value })).toThrowError(
      /RESERVATION_EXPIRY_INTERVAL_SECONDS/,
    );
  });
});
