// Catálogo único de errores de la API: código, estado HTTP y mensaje por defecto (en inglés).
export const ERROR_DEFINITIONS = {
  VALIDATION_ERROR: { status: 400, message: 'Invalid request' },
  UNAUTHORIZED: { status: 401, message: 'Authentication is required or the token is invalid' },
  INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password' },
  FORBIDDEN: { status: 403, message: 'You do not have permission to perform this action' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  EVENT_NOT_FOUND: { status: 404, message: 'Event not found' },
  EMAIL_ALREADY_EXISTS: { status: 409, message: 'Email already exists' },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },
} as const;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;
