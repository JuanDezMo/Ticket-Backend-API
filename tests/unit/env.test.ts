import { describe, expect, it } from 'vitest';
import { ConfigError, loadEnv } from '../../src/config/env.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_SECRET: 'a-secret-with-more-than-16-chars',
  PAYMENT_GATEWAY_URL: 'http://payment-gateway.test',
  PAYMENT_GATEWAY_API_KEY: 'gateway-key',
};

describe('loadEnv', () => {
  it('loads defaults when only the required variables are present', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.JWT_EXPIRES_IN_SECONDS).toBe(3600);
    expect(env.SEED_ADMIN_EMAIL).toBeUndefined();
  });

  describe('MAX_ACTIVE_HOLDS_PER_USER', () => {
    it('defaults to 8', () => {
      expect(loadEnv(valid).MAX_ACTIVE_HOLDS_PER_USER).toBe(8);
    });

    it.each(['1', '8'])('accepts %s', (value) => {
      expect(
        loadEnv({ ...valid, MAX_ACTIVE_HOLDS_PER_USER: value }).MAX_ACTIVE_HOLDS_PER_USER,
      ).toBe(Number(value));
    });

    it.each(['0', '-1', '2.5', 'many'])('rejects %s naming the variable', (value) => {
      expect(() => loadEnv({ ...valid, MAX_ACTIVE_HOLDS_PER_USER: value })).toThrowError(
        /MAX_ACTIVE_HOLDS_PER_USER/,
      );
    });
  });

  describe('PAYMENT_CLAIM_SECONDS', () => {
    it('defaults to 30, above the default gateway timeout of 5 seconds', () => {
      expect(loadEnv(valid).PAYMENT_CLAIM_SECONDS).toBe(30);
    });

    it('accepts a value just above the gateway timeout', () => {
      const env = loadEnv({
        ...valid,
        PAYMENT_GATEWAY_TIMEOUT_MS: '5000',
        PAYMENT_CLAIM_SECONDS: '6',
      });
      expect(env.PAYMENT_CLAIM_SECONDS).toBe(6);
    });

    it.each(['5', '1'])(
      'rejects %s seconds when it does not exceed the gateway timeout',
      (value) => {
        expect(() =>
          loadEnv({ ...valid, PAYMENT_GATEWAY_TIMEOUT_MS: '5000', PAYMENT_CLAIM_SECONDS: value }),
        ).toThrowError(/PAYMENT_CLAIM_SECONDS/);
      },
    );

    it('rejects 0 and non-numeric values', () => {
      for (const value of ['0', 'soon']) {
        expect(() => loadEnv({ ...valid, PAYMENT_CLAIM_SECONDS: value })).toThrowError(
          /PAYMENT_CLAIM_SECONDS/,
        );
      }
    });
  });

  it('fails naming JWT_SECRET when it is missing', () => {
    expect(() => loadEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrowError(/JWT_SECRET/);
  });

  it('fails naming DATABASE_URL when it is missing', () => {
    try {
      loadEnv({ ...valid, DATABASE_URL: undefined });
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

  it('defaults the payment gateway timeout to 5000 ms and accepts a custom one', () => {
    expect(loadEnv(valid).PAYMENT_GATEWAY_TIMEOUT_MS).toBe(5000);
    expect(
      loadEnv({ ...valid, PAYMENT_GATEWAY_TIMEOUT_MS: '250' }).PAYMENT_GATEWAY_TIMEOUT_MS,
    ).toBe(250);
  });

  it.each(['PAYMENT_GATEWAY_URL', 'PAYMENT_GATEWAY_API_KEY'])(
    'fails naming %s when it is missing',
    (name) => {
      const rest: Record<string, string> = { ...valid };
      delete rest[name];
      expect(() => loadEnv(rest)).toThrowError(new RegExp(name));
    },
  );

  it.each(['0', '-1', 'abc'])('rejects payment gateway timeout %j', (value) => {
    expect(() => loadEnv({ ...valid, PAYMENT_GATEWAY_TIMEOUT_MS: value })).toThrowError(
      /PAYMENT_GATEWAY_TIMEOUT_MS/,
    );
  });
});
