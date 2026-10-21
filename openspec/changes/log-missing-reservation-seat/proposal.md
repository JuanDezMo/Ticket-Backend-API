## Why

En `ReservationService.getForOwner`, si el seat de la reserva no existe se lanza `AppError('INTERNAL_ERROR')`. El `errorHandler` responde los `AppError` sin registrarlos en el log, así que este caso deja un `500` sin rastro. Eso incumple el requisito "Errores no controlados" de `api-foundation`, que exige registrar el detalle en el log. El caso no debería ocurrir por la clave foránea `reservations.seat_id → seats`; si ocurre, es un bug o hay datos corruptos, y es justamente cuando más se necesita el log.

## What Changes

- `getForOwner` lanza un `Error` normal con el id del seat y de la reserva, en lugar de `AppError('INTERNAL_ERROR')`. El `errorHandler` ya lo registra con su detalle y responde `500 INTERNAL_ERROR` con el mensaje genérico.
- La respuesta HTTP no cambia: sigue siendo `500` con `code` `INTERNAL_ERROR` y sin detalles internos.
- Se corrige la decisión 2 del design archivado `2026-10-21-reservation-detail`.

## Fuera de alcance

- Registrar en el log todos los `AppError` con estado `>= 500` desde el `errorHandler` (opción D de la revisión).
- Inyectar un `Logger` en `ReservationService` (opción C).
- El caso de `payment.service.ts` (API key rechazada), que ya registra el error antes de lanzar el `AppError`.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `seat-reservation`: se agrega el requisito de que una reserva cuyo seat no existe responda `500` genérico y quede registrada en el log.

## Impact

- Código: `src/modules/reservations/reservation.service.ts` (una línea).
- Pruebas: `tests/unit/reservation-service.test.ts` (el caso del seat inexistente).
- API: sin cambios en el contrato.
- Sin migraciones de BD ni dependencias nuevas.
