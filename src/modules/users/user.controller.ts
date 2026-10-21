import type { Request, Response } from 'express';
import type { CreateUserBody } from './user.schemas.js';
import { toPublicUser, type UserService } from './user.service.js';

export class UserController {
  constructor(private readonly userService: UserService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const user = await this.userService.createUser(req.body as CreateUserBody);
    res.status(201).json(toPublicUser(user));
  };
}
