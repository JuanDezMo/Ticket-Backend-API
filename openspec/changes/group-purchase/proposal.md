## Why

Con reservas por lote, el comprador debe pagar sus seats **juntos y una sola vez**. Hoy `POST /tickets/purchase` recibe un `reservationId` y genera un pago y un ticket (el pago y el ticket apuntan a una reserva). Pagar uno por uno multiplica cobros y comisiones, y haría más probable que el comprador pague unos y pierda otros al vencer.

## What Changes

- **Pedido (`orders`):** nueva tabla con usuario, evento, monto total y fecha. El pago apunta al pedido y cada reserva pagada guarda su `order_id`. La idempotencia, el monto y el `REFUND_PENDING` viven en una sola fila por compra.
- **Contrato único de lista:** `POST /tickets/purchase` recibe `{ reservationIds: [...], card }` (de 1 a `maxSeatsPerUser`) y responde siempre `{ orderId, amount, tickets: [...] }` con `201`. Una reserva sola es una lista de uno. **Sin alias** del campo anterior `reservationId`: el cuerpo es estricto y devuelve `400` con "reservationIds is required".
- **Un solo cobro por la suma:** el monto lo calcula el servidor sumando las reservas; la pasarela recibe una sola solicitud.
- **Todo o nada:** si alguna reserva no está `ACTIVE` y vigente, no es del usuario o hay repetidas, la compra falla completa sin llamar a la pasarela. Reservas de eventos distintos: `400 RESERVATIONS_MISMATCH`.
- **Un ticket por seat:** se emiten N tickets con el mismo pago. `tickets.reservation_id` sigue siendo único; `tickets.payment_id` deja de serlo.
- **Compra duplicada = error, no éxito repetido:** si alguna reserva ya está pagada, la solicitud responde `409 DUPLICATE_PAYMENT` ("posible duplicación de pago") sin llamar a la pasarela ni devolver los tickets existentes. Esto **cambia la regla actual** RN-TKT-13, que devolvía el mismo ticket con `200`. Ante solicitudes simultáneas, una responde `201` y las demás `409`.
- **Cancelación durante el pago:** si el evento se cancela con la pasarela ya aprobada, no se emite ningún ticket y el pago del pedido queda `REFUND_PENDING` una sola vez.
- **Pago en curso (evita el doble cobro desde el backend):** antes de cobrar, las reservas se **reclaman** de forma atómica (`payment_started_at`). Si otra solicitud ya las está cobrando, responde `409 PAYMENT_IN_PROGRESS` sin llamar a la pasarela. El reclamo se libera si el pago termina sin ticket (rechazo, error, datos inválidos), se mantiene tras un timeout `504` hasta vencer (`PAYMENT_CLAIM_SECONDS`, 30 por defecto, siempre mayor que el tiempo límite de la pasarela) y vence solo si el proceso cae. El registro de un doble cobro como `REFUND_PENDING` queda solo como red de seguridad.
- **Bloqueos en orden fijo:** evento, luego reservas por id ascendente, luego seats, para no cruzarse con la cancelación del evento.
- Los códigos de error de pago existentes (`PAYMENT_REJECTED`, `CARD_PROBLEM`, `PAYMENT_GATEWAY_ERROR`, `PAYMENT_GATEWAY_TIMEOUT`, etc.) aplican al pedido completo.
- La base se recrea: se edita la migración `005` (pedidos, pagos, tickets y la columna `order_id` de las reservas) sin migración de datos.

## Fuera de alcance

- Pagar reservas de distintos eventos o de distintos usuarios.
- Pago parcial dentro del pedido, o dividir el pago entre tarjetas.
- Reembolso de un seat suelto.
- Un endpoint para consultar un pedido (el cliente ya recibe los tickets).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `ticket-purchase`: la compra recibe una lista de reservas, crea un pedido, cobra la suma y emite varios tickets.
- `payment-gateway-client`: el monto enviado puede ser la suma de varias reservas.
- `ticket-listing`: cada seat sigue siendo un ticket; sin cambio de formato (se anota solo si el diseño lo requiere).

## Impact

- **Código:** `src/modules/tickets/*` (esquema, servicio, repositorio), módulo de pagos, `src/db/migrations/005` editada, y `src/db/types.ts`.
- **API:** `POST /tickets/purchase` cambia solicitud y respuesta (**BREAKING**, sin compatibilidad). Nuevos `400 RESERVATIONS_MISMATCH` y `409 PAYMENT_IN_PROGRESS`.
- **Pruebas y scripts:** pruebas de compra, `scripts/verify-gateway.sh` y la integración continua (cambio `ci-cd`).
- **Configuración:** variable nueva `PAYMENT_CLAIM_SECONDS` (`env.ts`, `docker-compose.yml`, `.env.example`).
- **Riesgos principales:** interbloqueos entre varias reservas y la cancelación del evento; reserva que vence entre validar y cobrar; un pedido con un monto mayor ante la pasarela; y que un cliente que no recibió la respuesta `201` (corte de red) vuelva a pagar y reciba `409 DUPLICATE_PAYMENT`, por lo que debe poder ver su ticket en `GET /tickets/me`.
- **Prioridad en las pruebas de integración contra la pasarela real:** (1) que acepte como `reservationId` el menor id del grupo con un monto de varias reservas; (2) que el conteo de 3 errores con la misma tarjeta siga funcionando cuando el usuario hace un nuevo intento con el mismo conjunto (`422` al tercero); (3) que acepte el monto total de un grupo de hasta 8 seats. Se extienden `scripts/verify-gateway.sh` y `docs/test-suite.md`.
- **Esfuerzo estimado:** 3,5 a 4,5 días con pruebas.
- **Depende de:** `seat-limit-enforcement`.
