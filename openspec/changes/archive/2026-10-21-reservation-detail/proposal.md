## Why

Después de reservar, la UI (`ticket_frontend`) muestra una cuenta regresiva y el checkout. Si el usuario recarga o vuelve más tarde, la UI no puede saber si su reserva sigue vigente, venció o fue cancelada porque el evento se canceló. Solo lo descubre al intentar pagar (`409`). Es el hueco 3 de `docs/api-integration.md` del frontend, y debe estar listo antes de su iteración `web-purchase`.

## What Changes

- Nuevo endpoint `GET /reservations/:id`, solo para el rol `USER` y solo para el dueño de la reserva. Responde `200` con el mismo cuerpo que `POST /reservations`.
- **Estado efectivo:** una reserva `ACTIVE` cuyo `expires_at` ya pasó, según la hora de la BD, se devuelve como `EXPIRED`, aunque el job de liberación todavía no haya corrido. Es el mismo criterio de la compra (RN-RES-7).
- Errores:
  - `401 UNAUTHORIZED` sin token;
  - `403 FORBIDDEN` si el rol no es `USER` o la reserva es de otro usuario (igual que la compra, RN-TKT-1);
  - `404 RESERVATION_NOT_FOUND` si no existe;
  - `400 VALIDATION_ERROR` si el `id` no es UUID.
- La consulta no modifica datos: no libera seats ni cambia estados.
- Se actualizan `docs/business-rules.md` (nueva regla RN-RES-8 y la tabla de permisos), `docs/architecture.md` (§11.2 y §11.3) y la tabla de endpoints del `README.md`.

## Fuera de alcance

- Listar las reservas del usuario (`GET /reservations/me`).
- Cancelar una reserva por parte del usuario (hueco 5, pospuesto).
- Incluir en la respuesta los datos del evento o el ticket emitido.
- Acceso del `ADMIN` a reservas ajenas.
- Cambios en la UI: se consumen en `web-purchase` del frontend.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `seat-reservation`: se agrega el requisito de consultar una reserva propia con su estado efectivo.

## Impact

- Código: `src/modules/reservations/` (`reservation.routes.ts`, `reservation.controller.ts`, `reservation.service.ts`, `reservation.schemas.ts`). Se reutilizan `ReservationRepository.findForPurchase`, `SeatService.findById` y `toPublicReservation`.
- Pruebas: `tests/unit/reservation-service.test.ts`, `tests/unit/reservation-schemas.test.ts` y `tests/integration/reservations-routes.test.ts`.
- API: un endpoint nuevo y compatible.
- Sin migraciones de BD ni dependencias nuevas.
