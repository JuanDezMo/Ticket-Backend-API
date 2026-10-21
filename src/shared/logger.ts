import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      // Nunca se registran contraseñas, tokens ni cabeceras de autorización
      redact: {
        paths: [
          'password',
          '*.password',
          'passwordHash',
          '*.passwordHash',
          'authorization',
          '*.authorization',
          'token',
          '*.token',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}
