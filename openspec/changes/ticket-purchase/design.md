## Context

Último cambio del flujo: usa `reservations` (reserva vigente), `events-seats` (evento y seat), `event-cancellation` (cascada por pasos) y `auth-users`. Reglas en `docs/business-rules.md` (secciones 6, 7 y 8, RN-TKT-1 a RN-TKT-12) y contrato en `docs/architecture.md` (secciones 7 y 11). El contrato de la pasarela está en `payment-gateway-microservice-project/docs/openapi.json`.

## Goals / Non-Goals

**Goals:**
- Cobrar una reserva y emitir el ticket sin doble cobro ni doble ticket, incluso con solicitudes simultáneas.
- No perder nunca el rastro de un cobro aprobado, aunque no pueda emitirse el ticket.
- Mantener los datos de tarjeta fuera de la BD y de los logs.

**Non-Goals:**
- Reembolsos reales, reintentos automáticos, historial de intentos (lo guarda la pasarela) y notificaciones.

## Decisions

**Módulos**
```
modules/payments/  payment-gateway.ts            interfaz PaymentGateway y tipos de resultado
                   http-payment-gateway.ts       implementación con fetch
                   payment.repository|service.ts tabla payments (registro de cobros)
                   payment.types.ts
modules/tickets/   ticket.routes|controller|service|repository|schemas|types.ts
modules/cancellations/steps/cancel-tickets.step.ts
```
`TicketService` orquesta y usa `ReservationService`, `EventService`, `SeatService` y `PaymentService`; nunca sus repositories. `PaymentService` expone el cobro (`charge`, delegando en `PaymentGateway`) y el registro (`recordApproved`, `recordRefundPending`, `markRefundPending`).

**`PaymentGateway` (interfaz)**
```
charge(req: { reservationId, amount, card }): Promise<GatewayResult>
GatewayResult = approved{transactionId} | rejected | cardFlagged | gatewayError
              | invalid{code, message} | misconfigured | timeout
```
`HttpPaymentGateway` usa `fetch` con `AbortSignal.timeout(PAYMENT_GATEWAY_TIMEOUT_MS)`, `Authorization: Bearer` y una sola llamada. Mapeo: `200` + `APPROVED` + `transactionId` → approved; `402` → rejected; `422` → cardFlagged; `502` → gatewayError; `400` → invalid (`BRAND_NOT_ALLOWED` se traduce a `CARD_BRAND_NOT_ALLOWED`); `401` → misconfigured (se registra el incidente sin la key); `TimeoutError` → timeout; error de red u otra respuesta, cuerpo ilegible o `200` sin `transactionId` → gatewayError. El servicio traduce el resultado a `AppError`. La interfaz permite sustituir la implementación en pruebas sin tocar `TicketService` (inversión de dependencias).

**Franquicia.** `parseCardBrand(value)` (función pura en `payments`) lanza `CARD_BRAND_REQUIRED` si es ausente, nula o vacía y `CARD_BRAND_NOT_ALLOWED` si no es `VISA`, `MASTERCARD` ni `AMEX` (insensible a mayúsculas); devuelve la marca en mayúsculas. El schema zod deja `card.brand` como `unknown` opcional para que ese error específico no se confunda con `VALIDATION_ERROR`, y el servicio la valida antes de cualquier consulta o llamada. El resto de campos de tarjeta solo se valida su presencia; el formato lo valida la pasarela.

**Flujo de `TicketService.purchase(userId, input)`** — la llamada HTTP **no** va dentro de una transacción de BD:
```
1. brand = parseCardBrand(input.card.brand)                         400 CARD_BRAND_*
2. reservation = ReservationService.findForPurchase(id)             404 RESERVATION_NOT_FOUND
   reservation.userId != userId                                      403 FORBIDDEN
3. si ya existe ticket de la reserva                                -> 200 con ese ticket (replay)
4. event = EventService.getById(reservation.eventId)                CANCELLED -> 409 EVENT_CANCELLED
   reservation no ACTIVE o vencida (hora de la BD)                  409 RESERVATION_EXPIRED
5. result = PaymentService.charge(...)                              una sola llamada, fuera de transacción
   no aprobado -> AppError (402 / 422 / 502 / 504 / 400 / 500)
6. aprobado -> db.transaction():
     a. EventService.findForShare(eventId, trx)                     bloquea el evento contra cancelaciones
     b. ReservationService.lockById(id, trx)                        SELECT ... FOR UPDATE
     c. si la reserva ya está CONFIRMED con ticket                  -> replay (carrera con otra solicitud)
     d. evento CANCELLED o reserva no ACTIVE                        -> registrar pago REFUND_PENDING
     e. confirmar reserva (ACTIVE->CONFIRMED), seat (RESERVED->SOLD),
        insertar pago APPROVED y ticket ISSUED
   (d) se confirma la transacción y después se lanza 409 EVENT_CANCELLED / RESERVATION_EXPIRED
7. si (e) falla de forma inesperada: la transacción se revierte y, en una transacción aparte,
   se registra el pago como REFUND_PENDING (el cobro ya ocurrió); respuesta 500 INTERNAL_ERROR.
```
El orden de bloqueos evento → reserva → seat evita interbloqueos con la cancelación del evento (que toma el evento primero) y con `releaseExpired` (que toma reservas y luego seats). Al ser un `FOR SHARE`, varias compras del mismo evento no se bloquean entre sí, pero una cancelación espera a que terminen y su paso de tickets ya ve los tickets emitidos.

**Idempotencia y concurrencia.** `UNIQUE (reservation_id)` en `tickets` y en `payments`, y el bloqueo de la reserva en el paso 6b: de varias solicitudes simultáneas, una emite el ticket y las demás ven la reserva `CONFIRMED` y devuelven el mismo ticket. Todas llaman a la pasarela, pero esta es idempotente por `reservationId` y devuelve el mismo `transactionId`.

**Datos.** Migración con:
- `payments`: `id` (uuid), `reservation_id` (FK, único), `user_id`, `event_id`, `transaction_id` (único), `amount` (`NUMERIC(12,2)`), `status` (`APPROVED`, `REFUND_PENDING`), `created_at`.
- `tickets`: `id` (uuid), `reservation_id` (FK, único), `payment_id` (FK, único), `user_id`, `event_id`, `seat_id`, `amount`, `status` (`ISSUED`, `CANCELLED_BY_EVENT`), `issued_at`.
- Índices: `tickets (user_id, issued_at DESC, id)`, `tickets (event_id) WHERE status = 'ISSUED'` y `payments (status)`. Los `CHECK` de estado van en la BD. `ON DELETE CASCADE` desde eventos y reservas, para que las pruebas puedan limpiar. Ninguna columna guarda datos de tarjeta.

**Cascada de la cancelación.** `CancelTicketsStep` (`name: 'tickets'`) llama a `TicketService.cancelByEvent(eventId, trx)`: `UPDATE tickets SET status='CANCELLED_BY_EVENT' WHERE event_id=$1 AND status='ISSUED' RETURNING payment_id` y `PaymentService.markRefundPending(paymentIds, trx)`; devuelve la cantidad. Se registra en `container.ts` después de seats y reservas, sin modificar `CancellationService`.

**Listado.** `GET /tickets/me` con `paginationSchema`, consulta con join a `events` y `seats` para `event` y la etiqueta, ordenada por `issued_at DESC, id`. Respuesta `{ data, meta }`.

**Configuración.** `PAYMENT_GATEWAY_URL` (URL, obligatoria), `PAYMENT_GATEWAY_API_KEY` (obligatoria, no vacía) y `PAYMENT_GATEWAY_TIMEOUT_MS` (entero positivo, 5000 por defecto) en `config/env.ts`. `docker-compose.yml` las pasa al contenedor y define `host.docker.internal` para alcanzar una pasarela local.

**Errores nuevos** (`ErrorCode`, mensajes en inglés): `CARD_BRAND_REQUIRED` y `CARD_BRAND_NOT_ALLOWED` (400), `RESERVATION_NOT_FOUND` (404), `RESERVATION_EXPIRED` y `EVENT_CANCELLED` (409), `PAYMENT_REJECTED` (402), `CARD_PROBLEM` (422), `PAYMENT_GATEWAY_ERROR` (502) y `PAYMENT_GATEWAY_TIMEOUT` (504).

**Logs.** La redacción de pino se amplía a `card`, `cvv`, `number` y `expiry`; `HttpPaymentGateway` nunca registra el cuerpo de la solicitud ni la API key, y los errores de red se registran solo con su tipo y mensaje.

**Pruebas.** Unitarias: `parseCardBrand`, schemas, `HttpPaymentGateway` y `TicketService` con la pasarela simulada. Integración con Testcontainers y **MSW** (única herramienta de mock, handlers basados en los ejemplos del `openapi.json`): cada respuesta de la pasarela (`200`, `400` ambos casos, `401`, `402`, `422`, `502`, cuerpo inválido, timeout y conexión caída), que la pasarela recibe una sola llamada y el contenido de la llamada, idempotencia y concurrencia, compra en vuelo (evento cancelado y reserva expirada), fallo inesperado tras el cobro, cascada de cancelación y que ni la BD ni los logs contienen datos de tarjeta. `dependency-cruiser` cubre los módulos nuevos.

## Risks / Trade-offs

- [Cobro aprobado sin ticket (compra en vuelo o fallo inesperado)] → se registra siempre como `REFUND_PENDING` para un proceso futuro; no hay reembolso automático en el MVP.
- [La pasarela cobra y el timeout vence antes de la respuesta] → la reserva sigue activa; reintentar es seguro porque la pasarela es idempotente por `reservationId` y devuelve el mismo `transactionId`.
- [Una compra puede terminar cuando el TTL de la reserva ya pasó] → se acepta si la reserva sigue `ACTIVE` (la validación de vigencia se hizo antes de cobrar); si el job ya la liberó, el pago queda `REFUND_PENDING`.
- [El bloqueo del evento (`FOR SHARE`) retrasa brevemente una cancelación] → ventana de milisegundos, a cambio de coherencia entre compra y cancelación.
- [Todas las solicitudes simultáneas llaman a la pasarela] → aceptado: la idempotencia de la pasarela evita el doble cobro.

## Migration Plan

Una migración nueva que se aplica al arrancar. Las variables de la pasarela pasan a ser obligatorias: actualizar `.env`, `.env.example` y `docker-compose.yml`. Reversión en desarrollo: revertir la migración o eliminar el volumen.

## Open Questions

- Ninguna que bloquee.
