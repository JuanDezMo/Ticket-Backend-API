export const RESERVATION_STATUSES = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  CANCELLED_BY_USER: 'CANCELLED_BY_USER',
} as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[keyof typeof RESERVATION_STATUSES];

export interface NewReservation {
  userId: string;
  seatId: string;
  eventId: string;
  amount: number;
}

export interface Reservation extends NewReservation {
  id: string;
  status: ReservationStatus;
  expiresAt: Date;
  createdAt: Date;
}

/** Respuesta pública: `seat` es la etiqueta (por ejemplo C7). */
export interface PublicReservation {
  id: string;
  eventId: string;
  seatId: string;
  seat: string;
  status: ReservationStatus;
  amount: number;
  expiresAt: string;
  createdAt: string;
}
