import type { Db } from '../../db/database.js';

/** Qué parte de la cascada representa un paso; define el campo de la respuesta que alimenta. */
export type CancellationStepName = 'seats' | 'reservations' | 'tickets';

/**
 * Un paso de la cascada de cancelación de un evento. Se ejecuta dentro de la transacción
 * recibida y devuelve cuántos registros afectó. Añadir un paso nuevo no modifica el servicio.
 */
export interface CancellationStep {
  readonly name: CancellationStepName;
  execute(eventId: string, trx: Db): Promise<number>;
}
