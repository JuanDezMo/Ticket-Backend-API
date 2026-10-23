import type { Request, Response } from 'express';
import type { PaginationParams } from '../../shared/utils/pagination.js';
import type { PurchaseBody } from './ticket.schemas.js';
import type { TicketService } from './ticket.service.js';

export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  purchase = async (req: Request, res: Response): Promise<void> => {
    // La identidad sale del token, nunca del cuerpo
    const result = await this.ticketService.purchase(req.auth!.userId, req.body as PurchaseBody);
    // Siempre 201: repetir una compra ya pagada responde 409 DUPLICATE_PAYMENT
    res.status(201).json(result);
  };

  listMine = async (req: Request, res: Response): Promise<void> => {
    const page = res.locals.query as PaginationParams;
    res.status(200).json(await this.ticketService.listMine(req.auth!.userId, page));
  };
}
