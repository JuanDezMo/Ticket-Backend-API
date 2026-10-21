## Why

Es el cierre del flujo del negocio: un USER paga una reserva y obtiene su ticket. Hasta ahora se pueden crear eventos, reservar seats y cancelar eventos, pero no cobrar ni emitir tickets, y la cancelación de eventos todavía no cubre tickets vendidos.

## What Changes

- Compra de una reserva (`POST /tickets/purchase`) con los datos de tarjeta: llama a la pasarela de pagos, y con `APPROVED` emite el ticket, pasa el seat a `SOLD` y la reserva a `CONFIRMED`.
- Cliente HTTP de la pasarela (`PaymentGateway`), con API key `Bearer`, timeout de 5 s configurable y sin reintentos automáticos. Traduce cada respuesta de la pasarela a un resultado interno y luego a un error de la API.
- `card.brand` obligatoria y validada antes de llamar a la pasarela, con dos errores específicos: `CARD_BRAND_REQUIRED` (ausente) y `CARD_BRAND_NOT_ALLOWED` (fuera de `VISA`, `MASTERCARD`, `AMEX`).
- Idempotencia por reserva: repetir la compra de una reserva ya pagada devuelve el mismo ticket, sin segundo cobro ni segundo ticket.
- Compras en vuelo: si el evento se cancela o la reserva deja de estar activa mientras se paga, no se emite el ticket y el pago queda registrado como `REFUND_PENDING`.
- Listado de los tickets del usuario (`GET /tickets/me`), paginado.
- Cascada de la cancelación de eventos: un `CancelTicketsStep` pasa los tickets emitidos a `CANCELLED_BY_EVENT` y marca sus pagos `REFUND_PENDING`; `cancelledTickets` deja de ser siempre 0.
- Migración con las tablas `payments` y `tickets`. Módulos nuevos `payments` y `tickets`.
- `ticket-api` no guarda ni registra datos de tarjeta.

## Capabilities

### New Capabilities
- `ticket-purchase`: compra de una reserva, validaciones, emisión del ticket, idempotencia y compras en vuelo.
- `payment-gateway-client`: contrato saliente hacia la pasarela, seguridad, timeout y traducción de respuestas.
- `ticket-listing`: consulta paginada de los tickets del usuario autenticado.

### Modified Capabilities
- `event-cancellation`: `cancelledTickets` cuenta los tickets emitidos que se cancelan, y sus pagos quedan `REFUND_PENDING`.

## Impact

- Código nuevo: módulos `src/modules/payments` y `src/modules/tickets`, `CancelTicketsStep` en `cancellations`, una migración y nuevos métodos en los repositories de `reservations`, `seats` y `events`.
- Rutas nuevas: `POST /tickets/purchase` y `GET /tickets/me`.
- Variables de entorno: `PAYMENT_GATEWAY_URL`, `PAYMENT_GATEWAY_API_KEY` y `PAYMENT_GATEWAY_TIMEOUT_MS` (5000 por defecto).
- Nuevos `ErrorCode`: `CARD_BRAND_REQUIRED`, `CARD_BRAND_NOT_ALLOWED`, `RESERVATION_NOT_FOUND`, `RESERVATION_EXPIRED`, `EVENT_CANCELLED`, `PAYMENT_REJECTED`, `CARD_PROBLEM`, `PAYMENT_GATEWAY_ERROR` y `PAYMENT_GATEWAY_TIMEOUT`.
- Dependencia de desarrollo: `msw` para simular la pasarela en las pruebas.
- Fuera de alcance: reembolsos reales (solo la marca `REFUND_PENDING`), cancelación de un ticket por el usuario, reintentos automáticos, historial de intentos de pago (lo guarda la pasarela) y notificaciones.
