## 1. Configuración, errores y datos

- [x] 1.1 Agregar `PAYMENT_GATEWAY_URL`, `PAYMENT_GATEWAY_API_KEY` (obligatorias) y `PAYMENT_GATEWAY_TIMEOUT_MS` (5000 por defecto) a `config/env.ts`, `.env.example`, `docker-compose.yml` (con `host.docker.internal`) y al `testEnv`; verificar con tests unitarios que falta de URL o API key aborta nombrando la variable, el valor por defecto y el rechazo de un timeout inválido
- [x] 1.2 Agregar los `ErrorCode` `CARD_BRAND_REQUIRED`, `CARD_BRAND_NOT_ALLOWED`, `RESERVATION_NOT_FOUND`, `RESERVATION_EXPIRED`, `EVENT_CANCELLED`, `PAYMENT_REJECTED`, `CARD_PROBLEM`, `PAYMENT_GATEWAY_ERROR` y `PAYMENT_GATEWAY_TIMEOUT` con sus mensajes en inglés (los de franquicia exactos de la spec); verificar con test unitario código HTTP y mensaje de cada uno
- [x] 1.3 Crear la migración de `payments` y `tickets` (FKs, únicos por reserva y por `transaction_id`, `CHECK` de estados, índices y cascadas); verificar en PostgreSQL de Testcontainers que un segundo ticket o pago para la misma reserva, un `transaction_id` repetido y un estado inválido son rechazados
- [x] 1.4 Regenerar `db/types.ts` con kysely-codegen; verificar que `pnpm build` compila
- [x] 1.5 Ampliar la redacción de pino a `card`, `cvv`, `number` y `expiry`; verificar con test unitario que un log con esos campos los muestra como `[REDACTED]`

## 2. Cliente de la pasarela

- [x] 2.1 Definir la interfaz `PaymentGateway`, los tipos de resultado y `parseCardBrand` (ausente, nula, vacía → requerida; fuera de lista → no permitida; minúsculas aceptadas y devueltas en mayúsculas); verificar con tests unitarios parametrizados cada caso y los dos mensajes exactos
- [x] 2.2 Agregar `msw` como dependencia de desarrollo y una utilidad de pruebas con handlers basados en los ejemplos del `openapi.json` de la pasarela; verificar que un test de humo recibe la respuesta simulada
- [x] 2.3 Implementar `HttpPaymentGateway` (cuerpo, header `Authorization: Bearer`, `AbortSignal.timeout`, una sola llamada y el mapeo de respuestas del diseño); verificar con tests contra MSW: contenido y header de la llamada, `200`, `402`, `422`, `502`, `400` con `BRAND_NOT_ALLOWED` y con `INVALID_REQUEST`, `401`, cuerpo no JSON, `200` sin `transactionId`, timeout con un límite pequeño y conexión caída (error de la pasarela, no timeout)
- [x] 2.4 Verificar que los errores del cliente no filtran la API key ni los datos de tarjeta en el mensaje ni en los logs

## 3. Pagos, reservas y seats (soporte de la compra)

- [x] 3.1 Implementar `PaymentRepository`/`PaymentService` (`recordApproved`, `recordRefundPending`, `markRefundPending(paymentIds)`) y `charge` que traduce el resultado de la pasarela a `AppError`; verificar con tests unitarios la traducción de cada resultado a su código HTTP y con tests de integración el registro de los estados
- [x] 3.2 Agregar `findForShare(id, executor)` a `EventRepository`/`EventService` (`SELECT ... FOR SHARE`); verificar con un test de integración que una cancelación concurrente espera a que termine la transacción que lo mantiene
- [x] 3.3 Agregar a `ReservationRepository`/`ReservationService` `findForPurchase(id)` (con `expired` calculado con `now()` de la BD), `lockById(id, executor)` (`FOR UPDATE`) y `markConfirmed(id, executor)` (UPDATE condicional a `ACTIVE`); verificar con tests de integración vigente, vencida por `expires_at`, ya confirmada y el UPDATE condicional
- [x] 3.4 Agregar `markSold(seatId, executor)` a `SeatRepository`/`SeatService` (UPDATE condicional desde `RESERVED`); verificar con tests de integración que cambia solo un seat `RESERVED`

## 4. Compra

- [x] 4.1 Implementar `TicketRepository` (crear, buscar por reserva, listar por usuario con evento y etiqueta, y cancelar por evento devolviendo los `payment_id`); verificar con tests de integración, incluido el orden `issued_at DESC, id` y que solo cancela tickets `ISSUED` del evento indicado
- [x] 4.2 Definir el schema de la compra (`reservationId` UUID, `card.number`, `card.expiry` y `card.cvv` no vacíos, `card.brand` desconocida, estricto, sin `amount`); verificar con tests unitarios cada caso
- [x] 4.3 Implementar `TicketService.purchase` con el flujo del diseño (validaciones previas, replay, cobro fuera de transacción, transacción con bloqueos evento → reserva → seat, rama de pago `REFUND_PENDING` y registro del cobro ante un fallo inesperado); verificar con tests unitarios con la pasarela simulada el orden de las validaciones, que no se llama a la pasarela cuando falla una validación previa, y cada rama
- [x] 4.4 Implementar `POST /tickets/purchase` (controller, routes, `authenticate` + `requireRole('USER')`) con la respuesta `{ id, reservationId, eventId, seat, status, amount, transactionId, issuedAt }` (`201`, y `200` en el replay); verificar con tests de integración con MSW: compra exitosa (ticket, seat `SOLD`, reserva `CONFIRMED`, monto del servidor), `403` ADMIN y reserva ajena, `401`, `400` por campos faltantes o `amount`, ambos errores de franquicia sin llamada a la pasarela, `404`, `409` `RESERVATION_EXPIRED` (vencida por `expires_at`, `EXPIRED` y `CANCELLED`) y `409` `EVENT_CANCELLED`
- [x] 4.5 Verificar cada respuesta de la pasarela de punta a punta: `402`, `422`, `502`, timeout, `400`, `401` y conexión caída devuelven el código HTTP y `code` de la spec, dejan la reserva `ACTIVE` y el seat `RESERVED`, no crean ticket ni pago, y la pasarela recibió exactamente una llamada
- [x] 4.6 Verificar la idempotencia: repetir la compra devuelve `200` con el mismo ticket y sin llamada nueva; varias solicitudes simultáneas dejan un solo ticket y un solo pago con el mismo `id` en las respuestas
- [x] 4.7 Verificar las compras en vuelo: con el evento cancelado (o la reserva expirada) entre la validación y el cobro, la respuesta es `409` `EVENT_CANCELLED` (o `RESERVATION_EXPIRED`), no hay ticket y existe un pago `REFUND_PENDING`; y un fallo inesperado al emitir revierte seat y reserva, deja el pago `REFUND_PENDING` y responde `500` `INTERNAL_ERROR`
- [x] 4.8 Verificar que ni la BD ni los logs contienen número, vencimiento ni CVV tras compras exitosas y fallidas

## 5. Listado y cancelación

- [x] 5.1 Implementar `GET /tickets/me` (controller, routes, `authenticate` + `requireRole('USER')`, paginación) con `{ data, meta }`; verificar con tests de integración tickets propios (orden), sin tickets de otros, `data` vacío, página 2 de 25, `400` con `pageSize` 21, `401` y `403` ADMIN
- [x] 5.2 Implementar `CancelTicketsStep` (`name: 'tickets'`) y registrarlo en `container.ts` después de seats y reservas; verificar con tests unitarios que delega en `TicketService.cancelByEvent` con la transacción y con tests de integración que el evento con 3 tickets los deja `CANCELLED_BY_EVENT`, sus pagos `REFUND_PENDING`, `cancelledTickets` es 3, los tickets siguen en `GET /tickets/me` y otro evento no cambia
- [x] 5.3 Verificar la carrera compra/cancelación: lanzar compras aprobadas a la vez que la cancelación del evento (repetido varias veces) y comprobar que no hay errores `5xx` ni interbloqueos, que no queda ningún ticket `ISSUED` en el evento cancelado y que todo pago de ese evento está `REFUND_PENDING` o corresponde a un ticket `CANCELLED_BY_EVENT`

## 6. Cierre

- [x] 6.1 Registrar los módulos `payments` y `tickets` en `container.ts` y `app.ts`; verificar que `pnpm arch` pasa (sin ciclos ni imports de repositories ajenos)
- [x] 6.2 Escribir el test de extremo a extremo con MSW (ADMIN crea evento, USER reserva, intenta pagar con tarjeta rechazada, luego paga con éxito y ve su ticket en `GET /tickets/me`, repite la compra y recibe el mismo ticket, el ADMIN cancela el evento y el ticket queda `CANCELLED_BY_EVENT`); verificar que `pnpm test` pasa completo
- [x] 6.3 Actualizar el `README` en español con los endpoints, las variables nuevas, la nota del código `200` en el replay y un ejemplo con `curl` (indicando cómo apuntar a la pasarela real o al mock), y actualizar la sección de SOLID de cancelación con el paso de tickets; actualizar `docs/architecture.md` y `docs/business-rules.md` donde cambió el contrato (`GET /tickets/me` con `meta`, replay `200`, marca en minúsculas); verificar siguiendo el README contra `docker compose` con la pasarela real o un servidor simulado
