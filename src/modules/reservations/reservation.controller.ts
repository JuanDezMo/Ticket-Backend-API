import type { Request, Response } from 'express';
import type { CreateReservationBody, ReservationIdParams } from './reservation.schemas.js';
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

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = res.locals.params as ReservationIdParams;
    // La identidad sale del token: solo el dueño puede consultar su reserva
    res.status(200).json(await this.reservationService.getForOwner(req.auth!.userId, id));
  };

  cancel = async (req: Request, res: Response): Promise<void> => {
    const { id } = res.locals.params as ReservationIdParams;
    // La identidad sale del token: solo el dueño puede cancelar su reserva
    res.status(200).json(await this.reservationService.cancelByOwner(req.auth!.userId, id));
  };
}
