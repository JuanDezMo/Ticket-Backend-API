## Context

Piezas que ya existen y se reutilizan:

- `ReservationRepository.findForPurchase(id)` devuelve `{ reservation, expired }`, con `expired` calculado con la hora de la BD. Ya lo usan la compra y `GET /reservations/:id`.
- `ReservationRepository.lockById(id, trx)` hace `SELECT ... FOR UPDATE`.
- `EventService.findForShare(id, trx)` bloquea el evento con `FOR SHARE`.
- `toPublicReservation(reservation, seatLabel)` y `SeatService.findById(id)` arman la respuesta, igual que `getForOwner`.
- `reservationIdParamsSchema` valida el `:id`.

Todo el código que lee el estado de una reserva compara **en positivo contra `ACTIVE`**: la compra, `markConfirmed`, `cancelActiveByEvent`, `releaseExpired`, el estado efectivo de `getForOwner` y el índice único parcial `reservations_seat_active_key`. Un estado nuevo queda fuera de todos ellos sin cambios, y el seat liberado se puede volver a reservar.

Orden de bloqueos actual:
- Cancelación del evento: evento (`UPDATE`) → seats (`BlockSeatsStep`) → reservas (`CancelReservationsStep`).
- Compra (`issue()`): evento (`FOR SHARE`) → reserva (`FOR UPDATE`) → seat.
- Liberación de vencidas: reservas → seats, en una sola sentencia.

## Goals / Non-Goals

**Goals:**
- Que el dueño libere su seat al instante, de forma atómica y segura frente a la cancelación del evento, la compra y la liberación de vencidas.
- Que la UI distinga la causa de cada estado final.

**Non-Goals:**
- Reembolsos o cancelación de reservas pagadas.
- Cambiar el `CANCELLED` existente.

## Decisions

### 1. Estado nuevo `CANCELLED_BY_USER`
Sigue el patrón de los tickets (`CANCELLED_BY_EVENT`). Así, la UI distingue "la cancelé yo" de "se canceló el evento" solo con la reserva.
- *Alternativa:* reutilizar `CANCELLED`. Se descarta: obliga a la UI a consultar el evento para saber la causa.
- *Alternativa:* `RELEASED`. Se descarta: se confunde con la liberación de vencidas.

### 2. Migración `006` del `CHECK`
`006-add-reservation-cancelled-by-user.ts`:
- `up`: elimina `reservations_status_check` y lo crea con `'ACTIVE', 'EXPIRED', 'CONFIRMED', 'CANCELLED', 'CANCELLED_BY_USER'`.
- `down`: convierte las reservas `CANCELLED_BY_USER` en `CANCELLED` y restaura el `CHECK` anterior. Así revierte siempre, a costa de perder la causa de esas filas.

### 3. Endpoint `POST /reservations/:id/cancel`
Sigue el patrón de `POST /events/:id/cancel`. La reserva no se borra, cambia de estado, así que un `DELETE` daría una idea equivocada.
- `router.post('/:id/cancel', authenticate, requireRole(ROLES.USER), validate(reservationIdParamsSchema, 'params'), controller.cancel)`.
- Responde `200` con `PublicReservation` y `status` `CANCELLED_BY_USER`.

### 4. Flujo de `ReservationService.cancelByOwner(userId, id)`
1. Fuera de la transacción, `findForPurchase(id)`: si es `null`, `RESERVATION_NOT_FOUND`; si `reservation.userId !== userId`, `FORBIDDEN`. El control de dueño va antes que cualquier otro dato, como en la consulta.
2. En una transacción, con el orden de bloqueos de la compra:
   1. `events.findForShare(reservation.eventId, trx)`.
   2. `reservations.lockById(id, trx)`.
   3. Según el estado bloqueado:
      - `CANCELLED_BY_USER` → `RESERVATION_ALREADY_CANCELLED`;
      - `CONFIRMED` → `RESERVATION_ALREADY_CONFIRMED`;
      - `CANCELLED`, o el evento ya no está `ACTIVE` → `EVENT_CANCELLED`;
      - `EXPIRED` → `RESERVATION_EXPIRED`.
   4. Si está `ACTIVE`: `reservations.markCancelledByUser(id, trx)`, un `UPDATE ... WHERE status = 'ACTIVE' AND expires_at > now()`. Si no actualiza ninguna fila, la reserva venció por tiempo → `RESERVATION_EXPIRED`. El vencimiento se decide con la hora de la BD dentro del mismo `UPDATE`, sin ventana entre leer y escribir.
   5. `seats.releaseReserved(seatId, trx)`: `RESERVED → AVAILABLE`.
3. Fuera de la transacción, `seats.findById` para la etiqueta y `toPublicReservation`. Si el seat no existe, `Error` normal, como en `getForOwner`.

Se usan las constantes de `RESERVATION_STATUSES`, sin literales.

### 5. El repository de reservas no toca `seats`
El seat se libera con un método nuevo de `SeatService` (`releaseReserved`), dentro de la misma transacción. `releaseExpired` es la excepción consciente porque libera muchas reservas en una sola sentencia; aquí es una sola fila y el bloqueo `FOR UPDATE` ya garantiza la atomicidad.
- `releaseReserved` filtra `status = 'RESERVED'`. Así no deshace un `BLOCKED` ni un `SOLD`.

### 6. Concurrencia
- **Con la cancelación del evento:** las dos operaciones toman primero el evento. La cancelación del evento hace un `UPDATE`, y `FOR SHARE` espera a que termine. Así quedan en fila y no puede haber interbloqueo con el orden seats → reservas del evento. Si el evento gana, la cancelación por el usuario ve el evento `CANCELLED` y la reserva `CANCELLED` → `409 EVENT_CANCELLED`.
- **Con la compra:** las dos bloquean la reserva con `FOR UPDATE`. Si la compra gana, la reserva queda `CONFIRMED` → `409 RESERVATION_ALREADY_CONFIRMED`. Si gana la cancelación, `issue()` ve `CANCELLED_BY_USER` y deja el pago en `REFUND_PENDING` (decisión 7).
- **Con la liberación de vencidas:** la sentencia bloquea reservas y luego seats, y solo toca reservas vencidas. Si toma la reserva primero, la cancelación ve `EXPIRED`. Si la toma la cancelación, el `UPDATE` del job espera y luego no la encuentra `ACTIVE`. No hay ciclo, porque la cancelación no espera ningún seat de otra reserva.
- **Dos cancelaciones del mismo usuario:** las dos bloquean la reserva con `FOR UPDATE`; la segunda ve `CANCELLED_BY_USER` → `409 RESERVATION_ALREADY_CANCELLED`.

### 7. Compra de una reserva cancelada por el usuario
En `TicketService`:
- Antes del cobro (paso 4): si `reservation.status === CANCELLED_BY_USER` → `RESERVATION_ALREADY_CANCELLED`, sin llamar a la pasarela. Va después del control de evento cancelado, como hoy.
- En `issue()`: si `locked.status === CANCELLED_BY_USER` → `refund` con `RESERVATION_ALREADY_CANCELLED`.
- Los demás estados no `ACTIVE` siguen respondiendo `RESERVATION_EXPIRED`.

El caso antes del cobro no estaba en la revisión. Se agrega para que el código sea el mismo antes y durante el pago.

### 8. Códigos de error
- `RESERVATION_ALREADY_CANCELLED`: `409`, "Reservation has already been cancelled".
- `RESERVATION_ALREADY_CONFIRMED`: `409`, "Reservation has already been paid".

Uno por caso, como `EVENT_ALREADY_CANCELLED` y `EVENT_ALREADY_ENDED`.

## Risks / Trade-offs

- [El usuario cancela mientras paga y la pasarela aprueba] → se le cobra y el pago queda `REFUND_PENDING`, igual que cuando la reserva vence durante el pago (RN-TKT-14). La UI debe deshabilitar "cancelar" mientras hay un pago en curso.
- [Clientes que esperan solo 4 estados] → el frontend todavía no implementa `web-purchase`; se avisa en su `docs/api-integration.md`.
- [El `down` pierde la causa] → aceptado: solo se usa para revertir un despliegue.
- [Un usuario reserva y cancela en bucle] → no bloquea a nadie más que el tiempo de su propia reserva. El límite de frecuencia queda fuera de alcance.
