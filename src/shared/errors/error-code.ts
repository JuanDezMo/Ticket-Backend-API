// Catálogo único de errores de la API: código, estado HTTP y mensaje por defecto (en inglés).
export const ERROR_DEFINITIONS = {
  VALIDATION_ERROR: { status: 400, message: 'Invalid request' },
  CARD_BRAND_REQUIRED: {
    status: 400,
    message: 'Card brand is required. Use VISA, MASTERCARD or AMEX',
  },
  CARD_BRAND_NOT_ALLOWED: {
    status: 400,
    message: 'Card brand not allowed. Use VISA, MASTERCARD or AMEX',
  },
  UNAUTHORIZED: { status: 401, message: 'Authentication is required or the token is invalid' },
  INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password' },
  FORBIDDEN: { status: 403, message: 'You do not have permission to perform this action' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  RESERVATION_NOT_FOUND: { status: 404, message: 'Reservation not found' },
  EVENT_NOT_FOUND: { status: 404, message: 'Event not found' },
  SEAT_NOT_FOUND: { status: 404, message: 'Seat not found' },
  SEAT_NOT_AVAILABLE: { status: 409, message: 'Seat is not available' },
  EVENT_ALREADY_CANCELLED: { status: 409, message: 'Event is already cancelled' },
  EVENT_ALREADY_ENDED: { status: 409, message: 'Event has already ended' },
  EVENT_NOT_ACTIVE: { status: 409, message: 'Event is not active or has already started' },
  RESERVATION_EXPIRED: { status: 409, message: 'Reservation has expired or is no longer active' },
  RESERVATION_ALREADY_CANCELLED: { status: 409, message: 'Reservation has already been cancelled' },
  RESERVATION_ALREADY_CONFIRMED: { status: 409, message: 'Reservation has already been paid' },
  EVENT_CANCELLED: { status: 409, message: 'Event has been cancelled' },
  SEAT_LIMIT_REACHED: { status: 409, message: 'Seat limit per user reached for this event' },
  HOLD_LIMIT_REACHED: { status: 409, message: 'Too many seats on hold. Pay or cancel some first' },
  PAYMENT_REJECTED: { status: 402, message: 'Payment was rejected. Try another card' },
  CARD_PROBLEM: { status: 422, message: 'The card has problems, use another payment method' },
  PAYMENT_GATEWAY_ERROR: { status: 502, message: 'Payment service error, please try again' },
  PAYMENT_GATEWAY_TIMEOUT: { status: 504, message: 'Payment service timed out, please try again' },
  EMAIL_ALREADY_EXISTS: { status: 409, message: 'Email already exists' },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },
} as const;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;
