import type { Logger } from '../../shared/logger.js';
import type { ReservationService } from './reservation.service.js';

/** Libera periódicamente las reservas vencidas de todos los eventos. */
export class ReservationExpiryJob {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly reservations: Pick<ReservationService, 'releaseExpired'>,
    private readonly logger: Logger,
    private readonly intervalSeconds: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.intervalSeconds * 1000);
    this.timer.unref(); // no mantiene vivo el proceso
    this.logger.info({ intervalSeconds: this.intervalSeconds }, 'Reservation expiry job started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Una ejecución; un fallo se registra y no detiene las siguientes. */
  async runOnce(): Promise<void> {
    if (this.running) return; // evita solapar ejecuciones lentas
    this.running = true;
    try {
      const released = await this.reservations.releaseExpired();
      if (released > 0) this.logger.info({ released }, 'Expired reservations released');
    } catch (error) {
      this.logger.error({ err: error }, 'Reservation expiry job failed');
    } finally {
      this.running = false;
    }
  }
}
