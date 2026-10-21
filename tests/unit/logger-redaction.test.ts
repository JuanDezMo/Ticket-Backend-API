import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/shared/logger.js';
import { createLogCapture } from '../helpers/log-capture.js';

describe('logger redaction', () => {
  it('redacts card data, secrets and credentials', () => {
    const capture = createLogCapture();
    const logger = createLogger('info', capture.stream);
    logger.info(
      {
        card: { brand: 'VISA', number: '4111111111111111', expiry: '12/28', cvv: '123' },
        body: { cvv: '999', number: '5555444433332222', expiry: '01/30' },
        password: 'secret-password',
        authorization: 'Bearer abc',
      },
      'sensitive data',
    );
    const text = capture.text();
    for (const secret of [
      '4111111111111111',
      '5555444433332222',
      '12/28',
      '01/30',
      '123',
      '999',
      'secret-password',
      'Bearer abc',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('[REDACTED]');
  });
});
