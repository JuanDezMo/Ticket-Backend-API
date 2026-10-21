## Why

Para comprar un ticket primero hay que apartar un lugar sin que otro usuario lo tome. Este cambio permite a un USER reservar un seat por un tiempo limitado y garantiza que las reservas vencidas liberen el seat, base de la compra (`ticket-purchase`) y de la cancelación de eventos.

## What Changes

- Reserva de un seat por un USER (`POST /reservations` con `eventId` y la etiqueta `seat`, por ejemplo `C7`), atómica y con precio calculado por el servidor.
- La reserva guarda `expires_at` (creación + TTL, 10 min por defecto, configurable con `RESERVATION_TTL_MINUTES`) con la hora de la BD.
- Liberación de reservas vencidas: al reservar y al listar los seats de un evento, y mediante un job periódico (cada 60 s).
- El listado de seats pasa a liberar primero las reservas vencidas del evento, para no mostrar seats ocupados por reservas ya vencidas.
- Migración de la BD con la tabla `reservations` (índice parcial de vencimiento y unicidad de una reserva activa por seat).
- Módulo nuevo `reservations`, reutilizando `authenticate`, `requireRole`, el módulo `events` y el módulo `seats`.

## Capabilities

### New Capabilities
- `seat-reservation`: creación de reservas por un USER, validaciones, atomicidad, estados y respuesta.
- `reservation-expiry`: `expires_at`, liberación de reservas vencidas (lazy y job periódico).

### Modified Capabilities
- `seat-inventory`: el listado de seats libera antes las reservas vencidas del evento.

## Impact

- Código nuevo: módulo `src/modules/reservations`, un job de expiración arrancado desde `server.ts` y una migración.
- Ruta nueva: `POST /reservations`. Ruta modificada: `GET /events/:id/seats`.
- Variables de entorno: `RESERVATION_TTL_MINUTES` (10 por defecto) y `RESERVATION_EXPIRY_INTERVAL_SECONDS` (60 por defecto).
- Nuevos `ErrorCode`: `SEAT_NOT_FOUND`, `SEAT_NOT_AVAILABLE` y `EVENT_NOT_ACTIVE` (`EVENT_NOT_FOUND` ya existe).
- Los cambios `event-cancellation` y `ticket-purchase` usan las reservas creadas aquí.
- Fuera de alcance: cancelar una reserva manualmente, listar las reservas del usuario, límite de reservas por usuario, y la compra (`ticket-purchase`) que valida `expires_at` al pagar.
