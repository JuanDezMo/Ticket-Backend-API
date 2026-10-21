import type { Request, Response } from 'express';
import { toPublicUser } from '../users/user.service.js';
import type { LoginBody, RegisterBody } from './auth.schemas.js';
import type { AuthService } from './auth.service.js';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  register = async (req: Request, res: Response): Promise<void> => {
    const user = await this.authService.register(req.body as RegisterBody);
    res.status(201).json(toPublicUser(user));
  };

  login = async (req: Request, res: Response): Promise<void> => {
    res.status(200).json(await this.authService.login(req.body as LoginBody));
  };
}
