import { AppError } from '../../shared/errors/index.js';
import { ROLES } from '../../shared/security/roles.js';
import type { PasswordHasher } from '../../shared/security/password-hasher.js';
import type { TokenService } from '../../shared/security/token-service.js';
import type { UserService } from '../users/user.service.js';
import type { User } from '../users/user.types.js';
import type { LoginBody, RegisterBody } from './auth.schemas.js';

export const TOKEN_TYPE = 'Bearer';

export interface LoginResult {
  accessToken: string;
  tokenType: typeof TOKEN_TYPE;
  expiresIn: number;
}

export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  /** El registro público crea siempre un USER. */
  register({ email, password }: RegisterBody): Promise<User> {
    return this.userService.createUser({ email, password, role: ROLES.USER });
  }

  async login({ email, password }: LoginBody): Promise<LoginResult> {
    const user = await this.userService.findByEmail(email);
    // Mismo error para email inexistente y contraseña incorrecta: no revela cuál falló
    if (!user || !(await this.hasher.verify(user.passwordHash, password))) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    const { token, expiresIn } = this.tokens.sign({ userId: user.id, role: user.role });
    return { accessToken: token, tokenType: TOKEN_TYPE, expiresIn };
  }
}
