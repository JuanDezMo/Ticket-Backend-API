import type { Request, Response } from 'express';
import type { PaginationParams } from '../../shared/utils/pagination.js';
import type { PurchaseBody } from './ticket.schemas.js';
import type { TicketService } from './ticket.service.js';

export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  purchase = async (req: Request, res: Response): Promise<void> => {
    // La identidad sale del token, nunca del cuerpo
    const { ticket, created } = await this.ticketService.purchase(
      req.auth!.userId,
      req.body as PurchaseBody,
    );
    // 201 al emitir; 200 si la reserva ya tenía ticket (repetición idempotente)
    res.status(created ? 201 : 200).json(ticket);
  };

  listMine = async (req: Request, res: Response): Promise<void> => {
    const page = res.locals.query as PaginationParams;
    res.status(200).json(await this.ticketService.listMine(req.auth!.userId, page));
  };
}
