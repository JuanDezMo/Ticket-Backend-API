## Why

Un ADMIN debe poder cancelar un evento sin borrarlo, dejando consistente lo que dependía de él: seats, reservas y (más adelante) tickets. Sin esto, un evento cancelado seguiría ofreciendo lugares o dejaría reservas colgadas.

## What Changes

- Cancelación de un evento por un ADMIN (`POST /events/:id/cancel`): el evento pasa a `CANCELLED` y no se elimina.
- Efecto en cascada, en una sola transacción:
  - Seats `AVAILABLE`, `RESERVED` y `SOLD` pasan a `BLOCKED`.
  - Reservas `ACTIVE` pasan a `CANCELLED` (no hubo cobro; las ya vencidas se tratan como `EXPIRED`).
- La respuesta incluye `cancelledReservations` y `cancelledTickets`. Como todavía no existen tickets, `cancelledTickets` vale 0; el cambio `ticket-purchase` extenderá la cascada para cancelarlos (`CANCELLED_BY_EVENT`) y marcar el pago `REFUND_PENDING`.
- Módulo nuevo `cancellations` que orquesta la cancelación mediante pasos intercambiables (`CancellationStep`) para `seats` y `reservations`, de modo que añadir tickets después no obligue a modificar el servicio (evita ciclos entre módulos y respeta SOLID).
- No requiere migraciones: usa las tablas existentes.

## Capabilities

### New Capabilities
- `event-cancellation`: cancelar un evento, reglas de elegibilidad, efecto en seats y reservas, atomicidad y concurrencia.

### Modified Capabilities

Ninguna. Los efectos sobre otros endpoints (no reservar en eventos cancelados, listado de eventos y seats) ya están cubiertos por `seat-reservation`, `event-management` y `seat-inventory`.

## Impact

- Código nuevo: módulo `src/modules/cancellations` y métodos nuevos en los repositories y services de `events`, `seats` y `reservations`.
- Ruta nueva: `POST /events/:id/cancel`.
- Nuevos `ErrorCode`: `EVENT_ALREADY_CANCELLED` y `EVENT_ALREADY_ENDED`.
- `ticket-purchase` deberá: cancelar los tickets emitidos, marcar el pago como `REFUND_PENDING` y manejar la compra en vuelo (RN-CAN-3).
- Fuera de alcance: reactivar un evento, reembolsos, notificaciones a los usuarios y la cascada sobre tickets.
