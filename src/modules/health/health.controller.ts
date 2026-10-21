import type { Request, Response } from 'express';
import type { HealthService } from './health.service.js';

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  check = async (_req: Request, res: Response): Promise<void> => {
    const up = await this.healthService.isDatabaseUp();
    res.status(up ? 200 : 503).json({ status: up ? 'UP' : 'DOWN' });
  };
}
