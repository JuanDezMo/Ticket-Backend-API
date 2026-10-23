## Context

- **Estado actual:** `TicketService.purchase` valida la franquicia, busca **una** reserva, devuelve el ticket existente si ya lo había (repetición idempotente), comprueba evento y vigencia, cobra una vez fuera de cualquier transacción y luego, en una transacción, bloquea evento → reserva → seat, confirma, registra el pago y crea el ticket. Si el evento se canceló o la reserva dejó de estar activa durante el cobro, registra el pago como `REFUND_PENDING` y responde `409`.
- **Modelo actual:** `payments.reservation_id` es único y `tickets.payment_id` es único: un pago por reserva y un ticket por pago. La cascada de cancelación del evento (`tickets.cancelByEvent`) devuelve los `payment_id` y el servicio los usa también para contar los tickets cancelados.
- **Pasarela:** su contrato es `{ reservationId, amount, card }` y es un proyecto externo. Cuenta los errores por reserva y tarjeta (3 errores seguidos → `422`).
- **Dependencia:** `seat-limit-enforcement` crea lotes de hasta 8 reservas por usuario y evento.
- Modelo completo y comparación con el actual: `docs/data-model.md`.

## Goals / Non-Goals

**Goals:**
- Un cobro único por la suma, todo o nada, sin tickets parciales y sin posibilidad de doble cobro silencioso.
- Que la cancelación de un evento con pedidos pagados y pagos pendientes siga siendo consistente.

**Non-Goals:**
- Reembolsos, pago parcial, varios eventos o varios usuarios en una compra.
- Un endpoint para consultar un pedido.

## Decisions

### 1. Una tabla `orders` y un módulo pequeño
`orders (id, user_id, event_id, amount, created_at)` y un módulo `orders` con repositorio y servicio mínimos (`create`). `reservations` gana `order_id` (FK nula) y `payments` pasa a `order_id` único; `tickets` agrega `order_id` y `payment_id` deja de ser único. Todo se edita en la migración `005` (que ya crea `payments` y `tickets`): crea `orders` primero, luego `payments` y `tickets` con sus claves nuevas, y al final `ALTER TABLE reservations ADD COLUMN order_id ... REFERENCES orders(id)` con un índice. No se reordenan ni renumeran las migraciones.
- *Alternativa:* tabla puente `payment_reservations`. Se descartó (ver la comparación del diseño de modelo): reparte la idempotencia y el reembolso pendiente entre varias tablas.

### 2. Flujo de la compra
1. Validar la franquicia (como hoy).
2. Cargar las reservas pedidas con una consulta que también indica si cada una venció por la hora de la base de datos (`findManyForPurchase`). Falta alguna → `404 RESERVATION_NOT_FOUND`.
3. Pertenencia: alguna ajena → `403 FORBIDDEN`. Eventos distintos → `400 RESERVATIONS_MISMATCH`.
4. Recorrer las reservas **en el orden de la solicitud** y responder el primer problema: `CONFIRMED` → `409 DUPLICATE_PAYMENT`; evento cancelado → `EVENT_CANCELLED`; `CANCELLED_BY_USER` → `RESERVATION_ALREADY_CANCELLED`; no `ACTIVE` o vencida → `RESERVATION_EXPIRED`. Sin llamar a la pasarela.
5. **Reclamo** de las reservas (decisión 4) y, a continuación, **un cobro** a la pasarela, **fuera de transacción** (como hoy), con la suma calculada en centavos enteros (nunca sumando decimales de punto flotante) y `reservationId` = el menor id de las reservas.
6. Transacción de emisión (decisión 3). Si la emisión no es posible tras cobrar: pago `REFUND_PENDING` y `409`.

### 3. Transacción de emisión y orden de bloqueos
Bloqueos en el mismo orden que la cancelación del evento y la liberación de vencidas: **evento (`FOR SHARE`) → reservas por id ascendente (`FOR UPDATE`) → seats por id ascendente**. Dentro: revalidar todas con el estado bloqueado (evento activo, cada reserva `ACTIVE`); si alguna dejó de estarlo, registrar el pago como `REFUND_PENDING` y responder el `409` que corresponda. Si todo está bien: crear el pedido y el pago `APPROVED`, confirmar las reservas, pasar los seats a `SOLD`, fijar `order_id` en las reservas, crear los tickets y devolverlos en el orden de la solicitud. Cualquier inconsistencia lanza una excepción y revierte todo, y el pago queda `REFUND_PENDING` en una escritura aparte (como hoy).

### 4. Reclamo de las reservas antes de cobrar (evita el doble cobro)
Entre los pasos 4 y 5 del flujo, una transacción corta ejecuta un reclamo atómico: `reservations.payment_started_at = now()` solo para las reservas del conjunto que estén `ACTIVE`, vigentes y sin reclamo reciente (`payment_started_at IS NULL OR payment_started_at < now() - PAYMENT_CLAIM_SECONDS`). Las filas se seleccionan con `ORDER BY id FOR UPDATE SKIP LOCKED`: una fila bloqueada por otra transacción se salta en vez de esperarse, así no hay interbloqueos entre conjuntos que se solapan. Si el número de filas reclamadas no es igual al de reservas del conjunto, la transacción se revierte (no queda ninguna reclamada) y se responde `409 PAYMENT_IN_PROGRESS` **sin llamar a la pasarela**.
- **Liberación:** tras un pago sin ticket por rechazo, tarjeta con problemas, error de la pasarela, datos inválidos o configuración inválida, el reclamo se limpia (`payment_started_at = NULL`) para que el usuario pueda hacer un nuevo intento de inmediato. Tras un timeout (`504`) **se mantiene** hasta que vence por tiempo, porque el resultado del cobro es desconocido y un nuevo intento inmediato del usuario podría duplicarlo. Con éxito, las reservas pasan a `CONFIRMED` y el reclamo ya no importa.
- **Vencimiento:** si el proceso cae a mitad del cobro, el reclamo vence solo. `PAYMENT_CLAIM_SECONDS` (30 por defecto) debe ser **mayor** que `PAYMENT_GATEWAY_TIMEOUT_MS`; `env.ts` lo valida al arrancar y, si no, falla con `ConfigError`.
- **Qué no bloquea:** la cancelación individual de una reserva y la cancelación del evento siguen siendo posibles durante el cobro; se resuelven en la transacción de emisión (decisión 3), igual que hoy.
- **Red de seguridad:** si el reclamo venció durante un cobro muy lento y otra solicitud terminó, al bloquear aparece alguna reserva `CONFIRMED`: se responde `409 DUPLICATE_PAYMENT`; si el `transactionId` cobrado es igual al del pedido existente no se registra nada, y si es distinto se registra un pedido y un pago `REFUND_PENDING` por el cobro extra y un aviso en el registro para conciliación.
- **Lo que no se puede evitar:** tras un `502` o un `504` el cobro pudo ocurrir; un nuevo intento del usuario **en serie** depende de que la pasarela trate igual el mismo `reservationId` (primera prueba prioritaria contra la pasarela real).
- *Alternativa descartada:* mantener una transacción abierta durante el cobro. Retiene una conexión y bloquea filas hasta el tiempo límite, frenando la cancelación de reservas y la liberación de vencidas.

### 5. Identificador enviado a la pasarela
Se envía como `reservationId` el menor id de las reservas (orden por texto del UUID). Es estable entre nuevos intentos del usuario con el mismo conjunto, así que se conserva el conteo de 3 errores por reserva y tarjeta. Un conjunto distinto (otro subconjunto) cuenta como una compra nueva para la pasarela; es una limitación asumida.

### 6. Contrato HTTP
`purchaseSchema`: `reservationIds` lista de 1 a `MAX_SEATS_PER_USER` UUID únicos, con el mensaje "reservationIds is required" cuando falta; `.strict()` (rechaza `reservationId` y `amount`). La respuesta es `{ orderId, amount, tickets }` y el controlador responde siempre `201`. Se elimina `PurchaseResult.created`.

### 7. Cancelación de un evento
`tickets.cancelByEvent` devuelve ahora `{ ticketCount, paymentIds }` con los `payment_id` **sin repetir**, porque varios tickets comparten pago. `TicketService.cancelByEvent` usa `ticketCount` para el resultado (`cancelledTickets`) y los `paymentIds` para pasar los pagos a `REFUND_PENDING` una sola vez cada uno. Sin este cambio el contador de tickets cancelados saldría menor al real.

### 8. Códigos de error y configuración
Se agregan al catálogo `DUPLICATE_PAYMENT` (`409`, "These reservations were already paid. Check your tickets before paying again"), `PAYMENT_IN_PROGRESS` (`409`, "Your payment is being processed. Try again in a few seconds") y `RESERVATIONS_MISMATCH` (`400`). `PAYMENT_CLAIM_SECONDS` (entero ≥ 1, 30 por defecto) se agrega a `env.ts`, `docker-compose.yml`, `.env.example` y `docs/ci-cd.md`.

### 9. Consumidores internos
`tests/helpers/purchase.ts` (`purchaseBody`, `insertTicket` con pedido y pago), las pruebas de compra, cancelación y listado de tickets, `scripts/verify-gateway.sh`, `README` y documentación.

## Risks / Trade-offs

- [Doble cobro por solicitudes simultáneas] → decisión 4: el reclamo atómico lo evita antes de llamar a la pasarela; si aun así ocurre (reclamo vencido), se detecta y se registra como `REFUND_PENDING`.
- [Nuevo intento del usuario tras un timeout o un `502` mientras se espera] → con el reclamo mantenido tras `504`, el usuario espera hasta `PAYMENT_CLAIM_SECONDS` (30 s por defecto); a cambio se evita duplicar un cobro cuyo resultado se desconoce.
- [La pasarela no acepta un `reservationId` de grupo o un monto mayor] → pruebas de integración prioritarias contra la pasarela real antes de aprobar el cambio; si falla, se ajusta la decisión 5.
- [Interbloqueos entre compra, cancelación del evento y liberación de vencidas] → orden único de bloqueos (decisión 3) y pruebas de concurrencia con cancelación simultánea.
- [Una reserva vence entre validar y cobrar] → se revalida bajo bloqueo (decisión 3) y queda `REFUND_PENDING`; el cobro de la pasarela es lento (hasta 5 s), por eso es el caso más probable.
- [Cliente que no recibió el `201` vuelve a pagar] → recibe `409 DUPLICATE_PAYMENT`; los tickets se consultan en `GET /tickets/me`. Se documenta para el frontend.
- [Redondeo] → la suma se hace en centavos enteros y el monto del pedido se compara con la suma de las reservas en la prueba.
- [BREAKING sin compatibilidad] → el único consumidor es el frontend propio (`web-group-checkout`); las pruebas, el script y la documentación se actualizan aquí.
- [Pago `REFUND_PENDING` de un pedido sin reservas asociadas] → en la ruta de reembolso pendiente no se fija `order_id` en las reservas (algunas siguen `ACTIVE`); el pedido y el pago conservan usuario, evento, monto y `transactionId` para la conciliación.
