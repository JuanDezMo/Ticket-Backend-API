import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReservationExpiryJob } from '../../src/modules/reservations/reservation-expiry.job.js';
import type { Logger } from '../../src/shared/logger.js';

const logger = () =>
  ({ info: vi.fn(), error: vi.fn() }) as unknown as Logger & {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

describe('ReservationExpiryJob', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs the error and keeps running after a failed execution', async () => {
    const releaseExpired = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(2);
    const log = logger();
    const job = new ReservationExpiryJob({ releaseExpired }, log, 60);

    await job.runOnce();
    await job.runOnce();

    expect(releaseExpired).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledOnce();
    expect(log.info).toHaveBeenCalledWith({ released: 2 }, 'Expired reservations released');
  });

  it('does not overlap executions', async () => {
    let finish: () => void = () => {};
    const releaseExpired = vi
      .fn()
      .mockReturnValue(new Promise<number>((r) => (finish = () => r(0))));
    const job = new ReservationExpiryJob({ releaseExpired }, logger(), 60);

    const first = job.runOnce();
    await job.runOnce(); // se ignora: la anterior sigue en curso
    finish();
    await first;

    expect(releaseExpired).toHaveBeenCalledTimes(1);
  });

  it('runs on every interval until stopped', async () => {
    vi.useFakeTimers();
    const releaseExpired = vi.fn().mockResolvedValue(0);
    const job = new ReservationExpiryJob({ releaseExpired }, logger(), 60);

    job.start();
    await vi.advanceTimersByTimeAsync(60_000 * 3);
    expect(releaseExpired).toHaveBeenCalledTimes(3);

    job.stop();
    await vi.advanceTimersByTimeAsync(60_000 * 3);
    expect(releaseExpired).toHaveBeenCalledTimes(3);
  });
});
