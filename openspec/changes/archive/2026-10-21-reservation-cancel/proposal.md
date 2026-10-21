## Why

Hoy una reserva solo se libera cuando vence su TTL (RN-RES-6) o cuando el ADMIN cancela el evento. Si el usuario se arrepiente o eligió mal el seat, el seat queda retenido hasta 10 minutos sin que nadie más pueda reservarlo, y el usuario no puede soltarlo. Es el hueco 5 de `docs/api-integration.md` del frontend, que se había pospuesto.

## What Changes

- Nuevo endpoint `POST /reservations/:id/cancel`, solo para el rol `USER` y solo para el dueño de la reserva. Una reserva `ACTIVE` y vigente pasa a **`CANCELLED_BY_USER`** y su seat vuelve a `AVAILABLE` en la misma transacción. Responde `200` con el mismo cuerpo que `POST /reservations`.
- **Nuevo estado de reserva `CANCELLED_BY_USER`**, distinto del `CANCELLED` que deja la cancelación del evento. Requiere la migración `006` del `CHECK` `reservations_status_check`. **BREAKING** (menor) para los clientes: `GET /reservations/:id` puede devolver un estado más.
- Respuestas `409` con un código por caso:
  - ya cancelada por el usuario → `RESERVATION_ALREADY_CANCELLED` (nuevo);
  - ya pagada → `RESERVATION_ALREADY_CONFIRMED` (nuevo);
  - vencida, aunque el job no la haya liberado → `RESERVATION_EXPIRED`;
  - cancelada porque se canceló el evento → `EVENT_CANCELLED`.
- Errores de acceso iguales a la consulta: `401` sin token, `403 FORBIDDEN` si el rol no es `USER` o la reserva es de otro usuario, `404 RESERVATION_NOT_FOUND`, `400 VALIDATION_ERROR` si el `id` no es UUID.
- **Compra:** una reserva `CANCELLED_BY_USER` responde `409 RESERVATION_ALREADY_CANCELLED`, tanto antes del cobro (sin llamar a la pasarela) como en la compra en vuelo (el pago queda `REFUND_PENDING`, RN-TKT-14).
- Se actualizan `docs/business-rules.md` (RN-RES-5, nueva RN-RES-9, RN-TKT-14 y la tabla de permisos), `docs/architecture.md` (§11.2 y §11.3) y la tabla de endpoints del `README.md`.

## Fuera de alcance

- Cancelar una reserva pagada o pedir reembolsos.
- Que el `ADMIN` cancele reservas ajenas.
- Renombrar el `CANCELLED` actual a `CANCELLED_BY_EVENT`.
- Cambios en la UI: se consumen en `web-purchase` del frontend, que debe conocer el estado nuevo.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `seat-reservation`: nuevo estado `CANCELLED_BY_USER` y requisitos de la cancelación por el dueño.
- `ticket-purchase`: una reserva cancelada por el usuario responde `RESERVATION_ALREADY_CANCELLED`, antes del cobro y en la compra en vuelo.

## Impact

- Código:
  - `src/modules/reservations/` (routes, controller, service, repository, types);
  - `src/modules/seats/` (`seat.repository.ts` y `seat.service.ts`: liberar un seat `RESERVED`);
  - `src/modules/tickets/ticket.service.ts` (código de la reserva cancelada por el usuario);
  - `src/shared/errors/error-code.ts` (2 códigos nuevos);
  - `src/db/migrations/006-add-reservation-cancelled-by-user.ts` y su registro en `index.ts`.
- Pruebas: unitarias del service de reservas, de la compra y de los códigos de error; integración de la ruta, de la compra, de la concurrencia con la cancelación del evento y de la migración.
- API: un endpoint nuevo, un estado nuevo en las respuestas de reserva y 2 códigos de error nuevos.
- BD: migración del `CHECK`, sin cambios de datos al aplicarla.
