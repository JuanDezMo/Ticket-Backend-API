import { MAX_CAPACITY, SEATS_PER_ROW, type SeatPosition } from './seat.types.js';

const LAST_ROW_LETTER = String.fromCharCode('A'.charCodeAt(0) + MAX_CAPACITY / SEATS_PER_ROW - 1);

/** Patrón de etiqueta válida: letra A..Z seguida de un número de 1 a SEATS_PER_ROW. */
export const SEAT_LABEL_PATTERN = new RegExp(
  `^[A-${LAST_ROW_LETTER}](${SEATS_PER_ROW}|[1-9])$`,
  'i',
);

/** "C7" -> { row: "C", number: 7 }. Acepta minúsculas; devuelve null si el formato es inválido. */
export function parseSeatLabel(label: string): SeatPosition | null {
  const trimmed = label.trim();
  if (!SEAT_LABEL_PATTERN.test(trimmed)) return null;
  return { row: trimmed.charAt(0).toUpperCase(), number: Number(trimmed.slice(1)) };
}
