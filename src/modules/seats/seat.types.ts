export const SEATS_PER_ROW = 10;
export const MAX_CAPACITY = 260; // filas A..Z de SEATS_PER_ROW puestos

export const SEAT_STATUSES = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  SOLD: 'SOLD',
  BLOCKED: 'BLOCKED',
} as const;

export type SeatStatus = (typeof SEAT_STATUSES)[keyof typeof SEAT_STATUSES];

export const SEAT_STATUS_VALUES = Object.values(SEAT_STATUSES) as [SeatStatus, ...SeatStatus[]];

export interface SeatPosition {
  row: string;
  number: number;
}

export interface Seat extends SeatPosition {
  id: string;
  eventId: string;
  status: SeatStatus;
}

export interface PublicSeat extends SeatPosition {
  id: string;
  label: string;
  status: SeatStatus;
}
