## Context

Continúa `events-seats` (eventos y seats) y `auth-users` (autenticación y roles). Alcance en `proposal.md`; reglas en `docs/business-rules.md` (sección 5, RN-RES-1 a RN-RES-7) y estrategia de expiración en `docs/architecture.md` (sección 8).

## Goals / Non-Goals

**Goals:**
- Reservar un seat de forma atómica, sin doble reserva ni siquiera con solicitudes concurrentes.
- Liberar reservas vencidas de forma confiable, con la hora de la BD como fuente de verdad.

**Non-Goals:**
- Cancelación manual de reservas, listado de reservas del usuario, límite por usuario, y la validación de `expires_at` en la compra (`ticket-purchase`).

## Decisions

**Módulo**
```
modules/reservations/  reservation.routes|controller|service|repository|schemas|types.ts
                       reservation-expiry.job.ts
```
`ReservationService` usa `SeatService` y `EventService`, nunca sus repositories. `SeatService` gana `findByEventAndLabel(eventId, row, number)` y `markReserved(seatId, executor)`; la etiqueta se convierte con la función pura `parseSeatLabel("C7") -> { row: "C", number: 7 }`. La ruta `GET /events/:id/seats` llama a `ReservationService.releaseExpired(eventId)` antes de listar (sin ciclos de archivos: `seat.controller` depende de `reservation.service`, y `reservation.service` de `seat.service`).

**Flujo de `POST /reservations`** (todo dentro de `db.transaction()`):
```
1. event = EventService.getById(eventId)         -> 404 EVENT_NOT_FOUND
2. event CANCELLED o startDate <= ahora           -> 409 EVENT_NOT_ACTIVE
   seat = SeatService.findByEventAndLabel(eventId, row, number) -> 404 SEAT_NOT_FOUND
3. releaseExpired(event.id, trx)                  libera las reservas vencidas del evento
4. markReserved(seatId, trx)                      UPDATE seats SET status='RESERVED' WHERE id=$1 AND status='AVAILABLE'
                                                  0 filas -> 409 SEAT_NOT_AVAILABLE
5. INSERT reservations (..., expires_at = now() + TTL, amount = event.price)
```
El evento se valida antes que el seat porque un evento cancelado tiene sus seats `BLOCKED` y debe responder `EVENT_NOT_ACTIVE`. Como el seat se busca dentro del evento indicado, una etiqueta de otro evento nunca resuelve un seat ajeno. Un fallo en el paso 5 revierte el paso 4.

**Atomicidad.** El `UPDATE ... WHERE status='AVAILABLE'` es la barrera: solo una transacción lo logra. Como segunda defensa, un índice único parcial `UNIQUE (seat_id) WHERE status = 'ACTIVE'` garantiza a nivel de datos una sola reserva activa por seat; su violación se traduce a `SEAT_NOT_AVAILABLE`.

**Datos.** Migración `reservations`: `id` (uuid), `user_id` (FK a `users`), `seat_id` (FK a `seats`), `event_id` (FK a `events`), `status` (`ACTIVE`, `EXPIRED`, `CONFIRMED`, `CANCELLED`, con `CHECK`), `amount` (`NUMERIC(12,2)`), `expires_at` y `created_at` (`timestamptz`). Índices: parcial `(expires_at) WHERE status = 'ACTIVE'` para la liberación, `(event_id) WHERE status = 'ACTIVE'` para la liberación por evento, y el único parcial por `seat_id`. `expires_at` se calcula con la hora de la BD: `now() + make_interval(mins => $ttl)`.

**`releaseExpired(eventId?)`.** Una sola sentencia atómica en el repository:
```
WITH expired AS (
  UPDATE reservations SET status = 'EXPIRED'
  WHERE status = 'ACTIVE' AND expires_at <= now() [AND event_id = $1]
  RETURNING seat_id)
UPDATE seats SET status = 'AVAILABLE'
WHERE id IN (SELECT seat_id FROM expired) AND status = 'RESERVED'
```
Es idempotente: dos ejecuciones simultáneas no se pisan, por lo que el job es seguro con varias instancias. Excepción consciente a "un repository solo toca su tabla": la sentencia modifica `seats` porque ambos cambios deben ser atómicos; queda encapsulada en un único método y documentada con un comentario.

**Job periódico.** `ReservationExpiryJob` con `setInterval` (`RESERVATION_EXPIRY_INTERVAL_SECONDS`, 60 por defecto), con guardia contra solapamiento y captura de errores (se registran y no detienen el job). `server.ts` lo inicia tras las migraciones y lo detiene en el apagado; el timer no mantiene vivo el proceso (`unref`). El intervalo se inyecta para poder probarlo con valores pequeños.

**Configuración.** `RESERVATION_TTL_MINUTES` (entero positivo, 10 por defecto) y `RESERVATION_EXPIRY_INTERVAL_SECONDS` (entero positivo, 60 por defecto) en `config/env.ts`.

**Validación y errores.** Schema estricto `{ eventId: uuid, seat: string }`, con `seat` validado por el patrón `^[A-Za-z](10|[1-9])$` y normalizado a mayúscula (constantes `SEATS_PER_ROW` y `MAX_CAPACITY` de `seats`). Nuevos `ErrorCode`: `SEAT_NOT_FOUND` (404), `SEAT_NOT_AVAILABLE` (409) y `EVENT_NOT_ACTIVE` (409). Ruta con `authenticate` + `requireRole('USER')`.

**Respuesta.** `{ id, eventId, seatId, seat, status, amount, expiresAt, createdAt }` con `seat` como etiqueta (`C7`), fechas ISO y `amount` como número.

**Pruebas.** Unitarias del servicio (orden de validaciones) con repositories simulados; integración con Testcontainers: reserva exitosa, concurrencia (varias solicitudes simultáneas), rollback, `releaseExpired` (vencida, vigente, vendida), liberación al reservar y al listar, y el job con intervalos de 1 s. Para forzar el vencimiento se actualiza `expires_at` en la BD de prueba. La regla de arquitectura de `dependency-cruiser` cubre el módulo nuevo.

## Risks / Trade-offs

- [Liberación lazy más job, con hasta 60 s de desfase en eventos que nadie consulta] → sin impacto en la corrección: reservar y listar liberan antes, y la compra valida `expires_at` por sí misma.
- [Una consulta extra por reserva y por listado de seats] → un `UPDATE` indexado que normalmente afecta 0 filas.
- [El repository de reservas modifica `seats`] → necesario para la atomicidad; encapsulado en un método.
- [`startDate` evaluado con el reloj del servidor al reservar] → suficiente; la expiración sí usa la hora de la BD.

## Migration Plan

Una migración nueva que se aplica al arrancar. Reversión en desarrollo: revertir la migración o eliminar el volumen de la BD.

## Open Questions

- Ninguna que bloquee.
