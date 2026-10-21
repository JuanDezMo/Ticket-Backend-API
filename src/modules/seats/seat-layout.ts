import { SEATS_PER_ROW, type SeatPosition } from './seat.types.js';

const FIRST_ROW_CHAR_CODE = 'A'.charCodeAt(0);

/** Genera exactamente `capacity` posiciones: filas A, B, C... de SEATS_PER_ROW puestos. */
export function generateSeatLayout(capacity: number): SeatPosition[] {
  return Array.from({ length: capacity }, (_, index) => ({
    row: String.fromCharCode(FIRST_ROW_CHAR_CODE + Math.floor(index / SEATS_PER_ROW)),
    number: (index % SEATS_PER_ROW) + 1,
  }));
}
