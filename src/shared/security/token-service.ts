import jwt from 'jsonwebtoken';
import { ROLE_VALUES, type Role } from './roles.js';

export interface TokenPayload {
  userId: string;
  role: Role;
}

export interface TokenService {
  sign(payload: TokenPayload): { token: string; expiresIn: number };
  /** Devuelve el payload o null si el token es inválido, está alterado o expiró. */
  verify(token: string): TokenPayload | null;
}

export class JwtTokenService implements TokenService {
  constructor(
    private readonly secret: string,
    private readonly expiresInSeconds: number,
  ) {}

  sign({ userId, role }: TokenPayload) {
    const token = jwt.sign({ role }, this.secret, {
      algorithm: 'HS256',
      subject: userId,
      expiresIn: this.expiresInSeconds,
    });
    return { token, expiresIn: this.expiresInSeconds };
  }

  verify(token: string): TokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
      if (typeof decoded === 'string') return null;
      const { sub, role } = decoded;
      if (!sub || !ROLE_VALUES.includes(role)) return null;
      return { userId: sub, role };
    } catch {
      return null;
    }
  }
}
