import { ERROR_DEFINITIONS, type ErrorCode } from './error-code.js';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? ERROR_DEFINITIONS[code].message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_DEFINITIONS[code].status;
  }
}
