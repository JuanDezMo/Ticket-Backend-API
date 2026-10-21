import type { Request, Response } from 'express';
import type { CreateReservationBody } from './reservation.schemas.js';
import type { ReservationService } from './reservation.service.js';

export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    // La identidad sale del token, nunca del cuerpo
    const reservation = await this.reservationService.create(
      req.auth!.userId,
      req.body as CreateReservationBody,
    );
    res.status(201).json(reservation);
  };
}
