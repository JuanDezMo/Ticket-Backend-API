import type { Request, Response } from 'express';
import type { CancellationService } from './cancellation.service.js';

export class CancellationController {
  constructor(private readonly cancellationService: CancellationService) {}

  cancel = async (_req: Request, res: Response): Promise<void> => {
    const { id } = res.locals.params as { id: string };
    res.status(200).json(await this.cancellationService.cancel(id));
  };
}
