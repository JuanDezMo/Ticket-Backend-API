# Plataforma de Tickets – Reglas de Negocio (MVP)

Estado: borrador para validación. Los temas técnicos de `ticket-api` (stack, BD, ORM) están pendientes de definir.

## 1. Alcance

Dos componentes:

- **ticket-api**: auth, eventos, seats, reservas, tickets. Es el proyecto que construimos.
- **payment-gateway**: proyecto externo con BD propia (Java 21, Spring Boot, PostgreSQL), en `/home/juandezmo/Documents/payment-gateway-microservice-project`. Su planeación vive en su propio cambio OpenSpec `payment-gateway`. Aquí solo se documenta el **contrato** que consume `ticket-api`; si hay diferencias, manda el spec de la pasarela.

```
Client --JWT--> ticket-api --HTTP (contrato)--> payment-gateway (externo)
```

Fuera del MVP: refresh tokens, endpoint de reembolso, zonas/precios por seat, emails, QR, webhooks, paginación avanzada.

## 2. Roles y autenticación

| Regla | Descripción |
|---|---|
| RN-AUTH-1 | El registro público (`POST /auth/register`) crea siempre un usuario `USER`; no acepta el campo `role`. |
| RN-AUTH-2 | El email es único. |
| RN-AUTH-3 | El login devuelve un JWT con `sub` (id de usuario) y `role`. |
| RN-AUTH-4 | Registro, login, listado y detalle de eventos son públicos. El resto exige JWT válido. |
| RN-AUTH-5 | Solo un `ADMIN` puede crear otros usuarios, con rol `USER` o `ADMIN`, mediante `POST /users`. |
| RN-AUTH-6 | El primer `ADMIN` se crea por seed al arrancar, con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`. Solo se crea si no existe ningún `ADMIN`; si ya existe, no hace nada. Si faltan las variables y no hay `ADMIN`, el arranque continúa y se registra un aviso. |

Permisos:

| Acción | ADMIN | USER |
|---|:-:|:-:|
| Crear usuarios (`USER` o `ADMIN`) | x | |
| Crear evento | x | |
| Cancelar evento | x | |
| Listar eventos y seats | x | x |
| Ver detalle de evento (también público) | x | x |
| Reservar seat | | x |
| Consultar mi reserva | | x |
| Cancelar mi reserva | | x |
| Comprar ticket | | x |
| Ver mis tickets | | x |

## 3. Eventos

Campos:

| Campo | Notas |
|---|---|
| `name` | Obligatorio |
| `description` | Obligatorio |
| `type` | `CONCERT`, `MEETUP`, `MEETING`, `OTHER` |
| `venue` | Obligatorio |
| `price` | Precio por ticket, mayor a 0 |
| `capacity` | Paramétrica por evento (ej. 20, 100). Entero entre 1 y 260 |
| `maxSeatsPerUser` | Máximo de seats que un usuario puede tener reservados o comprados en el evento. Entero entre 1 y 8, no mayor que `capacity`. Obligatorio, sin valor por defecto |
| `startDate` | Fecha y hora de inicio |
| `endDate` | Fecha y hora de fin |
| `createdAt` | Asignada por el sistema al crear el evento |
| `status` | `ACTIVE`, `CANCELLED` |

| Regla | Descripción |
|---|---|
| RN-EVT-1 | `startDate` debe ser futura y `endDate` posterior a `startDate`. |
| RN-EVT-2 | `capacity` la define el ADMIN al crear el evento. No se puede cambiar después de creado. |
| RN-EVT-3 | Un evento nunca se elimina; solo cambia de estado. |
| RN-EVT-4 | Al crear el evento se generan sus seats según `capacity` (sección 4). |
| RN-EVT-5 | Un evento `CANCELLED` sigue visible en el listado con su estado. |
| RN-EVT-6 | Se puede reservar y comprar solo mientras el evento esté `ACTIVE` y no haya llegado `startDate`. |
| RN-EVT-7 | El listado de eventos es paginado: `pageSize` entre 1 y 20 (por defecto 20); un valor mayor se rechaza con `400`, no se recorta. Admite filtros por estado, tipo, rango de `startDate` y texto en el nombre. |
| RN-EVT-8 | `maxSeatsPerUser` lo define el ADMIN al crear el evento, es obligatorio (sin valor por defecto), va de 1 a 8, no puede superar `capacity` y no se puede cambiar después. Esta regla solo guarda y expone el valor; aplicarlo al reservar es el cambio `seat-limit-enforcement`. |

## 4. Seats

La capacidad es paramétrica, así que el mapa de seats se genera con una regla fija: **10 puestos por fila, filas con letras desde `A`**.

| Capacidad | Seats generados |
|---|---|
| 20 | `A1..A10`, `B1..B10` |
| 25 | `A1..A10`, `B1..B10`, `C1..C5` (la última fila queda incompleta) |
| 100 | `A1..A10` hasta `J1..J10` |

| Regla | Descripción |
|---|---|
| RN-SEAT-1 | Se generan exactamente `capacity` seats. El tope de 260 corresponde a las filas `A..Z`. |
| RN-SEAT-2 | `(event_id, row, number)` es único. |
| RN-SEAT-3 | Estados: `AVAILABLE`, `RESERVED`, `SOLD`, `BLOCKED`. |
| RN-SEAT-4 | El listado de lugares disponibles filtra por `AVAILABLE` y solo aplica a eventos `ACTIVE`. |

```
AVAILABLE --reservar--> RESERVED --pago aprobado--> SOLD
    ^                       |
    +--- TTL / cancelada ---+
    (cancelada = el dueño cancela su reserva, RN-RES-9)

Cualquier estado --evento cancelado--> BLOCKED
```

## 5. Reservas

| Regla | Descripción |
|---|---|
| RN-RES-1 | Solo un USER puede reservar, y solo seats `AVAILABLE` de eventos `ACTIVE`. |
| RN-RES-2 | La reserva retiene el seat durante un TTL (por defecto 10 min, configurable). |
| RN-RES-3 | Al vencer el TTL, la reserva pasa a `EXPIRED` y el seat vuelve a `AVAILABLE`, mediante la liberación descrita en RN-RES-6. |
| RN-RES-4 | Reservar es atómico: dos usuarios no pueden reservar el mismo seat. |
| RN-RES-5 | Estados: `ACTIVE`, `EXPIRED`, `CONFIRMED`, `CANCELLED` (se canceló el evento) y `CANCELLED_BY_USER` (la canceló su dueño). |
| RN-RES-6 | La reserva guarda `expires_at` (creación + TTL) calculado con la hora de la BD. Las reservas vencidas se liberan en dos momentos: al listar seats disponibles o reservar en un evento, y por un job periódico (cada 60 s). Ambos usan la misma operación. |
| RN-RES-7 | La compra siempre valida `expires_at > now()`; si no se cumple, responde `RESERVATION_EXPIRED`. La corrección no depende de que el job haya corrido. |
| RN-RES-8 | Un USER puede consultar solo sus propias reservas; una reserva `ACTIVE` con `expires_at <= now()` se informa como `EXPIRED` sin modificarla. |
| RN-RES-9 | El dueño puede cancelar su reserva `ACTIVE` y vigente con `POST /reservations/:id/cancel`. La reserva pasa a `CANCELLED_BY_USER` y el seat a `AVAILABLE` en una sola transacción. Si no se puede cancelar, se responde `409` con un código según el estado: `RESERVATION_ALREADY_CANCELLED`, `RESERVATION_ALREADY_CONFIRMED`, `RESERVATION_EXPIRED` o `EVENT_CANCELLED`. |
| RN-RES-10 | Se reservan de 1 a 8 seats en una sola solicitud (`seats`): todas las reservas se crean juntas, todo o nada, con el mismo `created_at` y `expires_at`. Una solicitud posterior crea un lote nuevo con su propio vencimiento; nada renueva ni extiende reservas existentes. |
| RN-RES-11 | **Límite por evento:** reservas `ACTIVE` vigentes + `CONFIRMED` del usuario en el evento + los seats solicitados no pueden superar `maxSeatsPerUser` del evento (`409 SEAT_LIMIT_REACHED`). No cuentan las `EXPIRED`, `CANCELLED`, `CANCELLED_BY_USER` ni una `ACTIVE` ya vencida. Un ticket comprado cuenta (su reserva está `CONFIRMED`). |
| RN-RES-12 | **Tope global:** un usuario no puede tener más de `MAX_ACTIVE_HOLDS_PER_USER` (8 por defecto) reservas `ACTIVE` vigentes a la vez, sumando todos los eventos (`409 HOLD_LIMIT_REACHED`). Lo ya comprado no cuenta. |
| RN-RES-13 | Orden de las validaciones al reservar: acceso, formato, evento existente, evento activo y no iniciado, seats existentes, límite del evento, tope global y, al final, disponibilidad de los seats. |
| RN-RES-14 | El conteo y la creación ocurren en la misma transacción, bajo un bloqueo por usuario tomado antes de contar, y los seats se bloquean por id ascendente: solicitudes simultáneas nunca superan los límites ni se bloquean entre sí. |

## 6. Compra de tickets

| Regla | Descripción |
|---|---|
| RN-TKT-1 | Solo el dueño de la reserva puede comprarla, y solo si está `ACTIVE` y dentro del TTL (RN-RES-7). |
| RN-TKT-2 | La compra llama a `payment-gateway`. Con `APPROVED` se emite el ticket, el seat pasa a `SOLD` y la reserva a `CONFIRMED`. |
| RN-TKT-3 | Si la pasarela no aprueba el pago (402, 422, 502, 400 o 401), no se emite ticket. La reserva sigue `ACTIVE` hasta su TTL. La reacción de `ticket-api` a cada respuesta está en 8.7. |
| RN-TKT-4 | `ticket-api` no cuenta intentos de pago. Solo reacciona a la respuesta de la pasarela, que es la dueña del conteo por tarjeta (sección 8.3). |
| RN-TKT-5 | La compra es idempotente por `reservationId`: una vez `APPROVED`, un reintento no genera doble cobro ni doble ticket. Cada reserva tiene un `reservationId` (UUID) único que nunca se reutiliza, porque la pasarela basa su idempotencia en él. |
| RN-TKT-6 | Estados del ticket: `ISSUED`, `CANCELLED_BY_EVENT`. |
| RN-TKT-7 | Antes de emitir el ticket se verifica, en la misma transacción, que el evento siga `ACTIVE`. |
| RN-TKT-8 | La llamada a la pasarela tiene un timeout de 5 s (`PAYMENT_GATEWAY_TIMEOUT_MS`, configurable). Si lo supera, no se emite ticket y la reserva sigue `ACTIVE`. Reintentar es seguro: si la pasarela alcanzó a aprobar, el reintento devuelve el mismo `APPROVED` sin cobrar de nuevo. |
| RN-TKT-9 | Al aprobarse el pago, el ticket guarda `transactionId` y `amount`. El `amount` lo calcula `ticket-api` con el precio del evento; nunca se toma del cliente. |
| RN-TKT-10 | `ticket-api` reenvía los datos de la tarjeta (`brand`, `number`, `expiry`, `cvv`) a la pasarela y no los guarda ni los registra en logs. |
| RN-TKT-11 | `ticket-api` no reintenta automáticamente la llamada a la pasarela, sea cual sea la respuesta (incluidos `502` y timeout). El reintento lo inicia el usuario. Así no se altera el conteo de intentos de la pasarela (máximo 3 con error) ni se envían cobros duplicados. |
| RN-TKT-12 | `card.brand` es obligatoria en la compra y debe ser `VISA`, `MASTERCARD` o `AMEX` (se acepta en minúscula y se envía en mayúscula). `ticket-api` la valida antes de llamar a la pasarela, sin llamada ni cobro si falla, y responde `400` con un mensaje específico según el caso: (a) campo ausente, vacío o nulo → `CARD_BRAND_REQUIRED`, "Card brand is required. Use VISA, MASTERCARD or AMEX"; (b) valor que no pertenece a la lista que maneja la pasarela → `CARD_BRAND_NOT_ALLOWED`, "Card brand not allowed. Use VISA, MASTERCARD or AMEX". Si la pasarela respondiera `BRAND_NOT_ALLOWED`, `ticket-api` lo traduce al mismo `CARD_BRAND_NOT_ALLOWED`. |
| RN-TKT-13 | **Compra duplicada = error.** Si alguna reserva de la solicitud ya está pagada (`CONFIRMED`), se responde `409 DUPLICATE_PAYMENT` ("posible duplicación de pago"): no se llama a la pasarela, no se crea nada y no se devuelven los tickets ya emitidos (se consultan en `GET /tickets/me`). La compra siempre responde `201` al emitir. Reemplaza la regla anterior, que devolvía el mismo ticket con `200`. |
| RN-TKT-14 | Si tras aprobarse el cobro el evento fue cancelado o la reserva dejó de estar activa, no se emite el ticket, se responde `409` (`EVENT_CANCELLED`, `RESERVATION_ALREADY_CANCELLED` si el dueño la canceló, o `RESERVATION_EXPIRED`) y el pago queda registrado como `REFUND_PENDING`. Lo mismo ocurre si falla de forma inesperada la emisión. |
| RN-TKT-15 | **Compra de varias reservas.** `POST /tickets/purchase` recibe `reservationIds` (de 1 a 8, sin repetir; el campo antiguo `reservationId` ya no existe). Todas deben ser del usuario, del mismo evento (`RESERVATIONS_MISMATCH`) y pagables; si una no lo es, falla toda la compra (todo o nada) sin llamar a la pasarela. |
| RN-TKT-16 | Cada compra crea un **pedido** con el monto total (suma de las reservas, calculada en el servidor en centavos), **un solo cobro** a la pasarela y un ticket por reserva. Respuesta: `{ orderId, amount, tickets }`, en el orden de la solicitud. |
| RN-TKT-17 | El total del pedido no puede superar 9.999.999.999,99 (lo que aceptan la pasarela y el campo de monto): `400 ORDER_AMOUNT_TOO_LARGE`, antes de reclamar y cobrar. |
| RN-TKT-18 | **Pago en curso.** Antes de cobrar, las reservas se reclaman de forma atómica (`payment_started_at`). Si alguna ya tiene un pago en curso (menos de `PAYMENT_CLAIM_SECONDS`, 30 por defecto), `409 PAYMENT_IN_PROGRESS` sin llamar a la pasarela. El reclamo se libera tras un rechazo, error de la pasarela o datos inválidos (nuevo intento inmediato), se mantiene tras un timeout (`504`) hasta vencer y vence solo si el proceso cae. `PAYMENT_CLAIM_SECONDS` debe ser mayor que `PAYMENT_GATEWAY_TIMEOUT_MS`. **Un reclamo fallido no siempre es un pago en curso:** si no se pudo reclamar, se vuelven a leer las reservas y el evento y se responde la causa real (`EVENT_CANCELLED`, `RESERVATION_ALREADY_CANCELLED`, `RESERVATION_EXPIRED`, `DUPLICATE_PAYMENT`); `PAYMENT_IN_PROGRESS` solo si alguna tiene un reclamo reciente. Si nada cambió ni hay otro cobro, las filas las bloquea un instante otra transacción (cancelar el evento o la reserva, el job de vencimiento) y se reintenta hasta 8 veces cada 50 ms antes de responder `PAYMENT_IN_PROGRESS`. |
| RN-TKT-19 | **Identificador enviado a la pasarela.** Ella es idempotente solo por `reservationId` (devuelve el mismo `transactionId` aunque cambien el monto o la tarjeta). Se envía el id de la reserva si es una y, si son varias, un UUID v5 de los ids ordenados: el mismo conjunto da siempre el mismo id y dos conjuntos distintos nunca lo comparten. |
| RN-TKT-20 | Si tras el cobro el evento se canceló o alguna reserva dejó de estar activa, no se emite ningún ticket y se registra **un solo pago** `REFUND_PENDING` por el total del pedido. Al cancelar un evento, `cancelledTickets` cuenta tickets (no pagos) y cada pago compartido pasa a `REFUND_PENDING` una vez. |

## 7. Cancelación de eventos

Solo un ADMIN puede cancelar. No se puede cancelar un evento que ya terminó (`endDate` pasada) ni uno ya cancelado.

```
Event: ACTIVE --cancelar (ADMIN)--> CANCELLED   (terminal)
```

Al cancelar, en una sola transacción:

| Elemento | Resultado |
|---|---|
| Evento | `CANCELLED` |
| Seats `AVAILABLE`, `RESERVED` y `SOLD` | `BLOCKED` |
| Reservas `ACTIVE` | `CANCELLED` (no hubo cobro, no hay nada que devolver) |
| Tickets `ISSUED` | `CANCELLED_BY_EVENT`; el pago asociado queda marcado `REFUND_PENDING` en `ticket-api` |

| Regla | Descripción |
|---|---|
| RN-CAN-1 | No se admiten reservas ni compras nuevas sobre un evento cancelado. |
| RN-CAN-2 | Los tickets no se borran; se conservan por trazabilidad. |
| RN-CAN-3 | Compra en vuelo: si la pasarela aprobó pero el evento ya está `CANCELLED`, no se emite ticket y se registra en `ticket-api` el `transactionId` de ese pago como `REFUND_PENDING`. |
| RN-CAN-4 | MVP: no hay reembolso. `REFUND_PENDING` es solo una marca para un proceso futuro, vive en `ticket-api` (con el `transactionId` guardado en el ticket o en el registro de compra) y la pasarela no tiene endpoint de reembolso. |

## 8. Pasarela de pagos (contrato)

Proyecto externo e independiente. `ticket-api` solo depende del contrato de esta sección. La pasarela publica su contrato como OpenAPI en `/v3/api-docs`; en `ticket-api` se usa para construir el mock de pruebas.

### 8.1 Endpoint

`POST /payments`

Header obligatorio: `Authorization: Bearer <api-key>` (ver 8.6). Todos los mensajes de respuesta están en inglés.

Solicitud:

```json
{
  "reservationId": "uuid",
  "amount": 150000,
  "card": { "brand": "VISA", "number": "4111111111111111", "expiry": "12/28", "cvv": "123" }
}
```

`card.brand` es la franquicia y **`ticket-api` siempre la envía** (RN-TKT-12). Valores permitidos: `VISA`, `MASTERCARD`, `AMEX`. `ticket-api` la solicita al usuario junto con los demás datos de la tarjeta, la valida y la reenvía. El contrato OpenAPI de la pasarela la marca como opcional, pero para `ticket-api` es obligatoria.

El request no incluye número de intento: la pasarela lo calcula (8.3).

### 8.2 Validación y simulación

El **resultado** (formato válido, `REJECTED`, `ERROR`, `APPROVED`) se decide **en memoria, sin consultar la BD**, en este orden:

1. Validaciones de formato. Si falla alguna responde `400` `INVALID_REQUEST`, sin cobro:
   - Franquicia (`brand`) dentro de `VISA`, `MASTERCARD` o `AMEX`. Si no, responde `400` `BRAND_NOT_ALLOWED` ("Card brand not allowed"). Solo se valida que pertenezca a la lista, no que el número corresponda a la marca.
   - Número de tarjeta compuesto solo por dígitos, de 13 a 19 de largo. No se valida Luhn.
   - Vencimiento con formato `MM/YY` y tarjeta no vencida.
   - CVV de 3 dígitos.
   - `amount > 0`.
2. Según el final del número de tarjeta:

| La tarjeta termina en | Resultado |
|---|---|
| `0000` | `REJECTED` |
| `9999` | Error simulado (ver 8.3) |
| cualquier otro | `APPROVED` |

### 8.3 Intentos con error simulado (`9999`)

La pasarela calcula el número de intento contando los intentos previos guardados para `(reservation_id, card_fingerprint)` y sumando 1.

```
intento 1 --9999--> ERROR        (se guarda, se permite reintentar)
intento 2 --9999--> ERROR        (se guarda, se permite reintentar)
intento 3 --9999--> CARD_FLAGGED (se guarda y se notifica el problema de la tarjeta)
```

- El conteo es **por reserva y por tarjeta**. Lo lleva la pasarela, no `ticket-api`. El máximo de intentos con error (3) es configurable en la pasarela.
- Si el usuario cambia el número de tarjeta, el conteo empieza de nuevo (otro `card_fingerprint`).
- Cada intento se guarda, sea cual sea su resultado (8.5).
- Esta es la única lectura de BD del flujo, junto con la idempotencia de `APPROVED` (RN-PAY-2).

### 8.4 Respuestas

| Caso | HTTP | Cuerpo |
|---|---|---|
| Aprobado (incluye reintento idempotente) | 200 | `{ "status": "APPROVED", "transactionId": "..." }` |
| Rechazado (`0000`) | 402 | `{ "status": "REJECTED", "code": "INSUFFICIENT_FUNDS", "message": "Insufficient funds" }` |
| Error simulado, intento 1 o 2 | 502 | `{ "status": "ERROR", "code": "GATEWAY_ERROR", "message": "Error processing the payment, please try again" }` |
| Error simulado, intento 3 | 422 | `{ "status": "CARD_FLAGGED", "code": "CARD_PROBLEM", "message": "The card has problems, use another payment method" }` |
| Formato inválido | 400 | `{ "status": "INVALID", "code": "INVALID_REQUEST", "message": "Invalid request" }` |
| Franquicia no permitida | 400 | `{ "status": "INVALID", "code": "BRAND_NOT_ALLOWED", "message": "Card brand not allowed. Use VISA, MASTERCARD or AMEX" }` |
| API key ausente o inválida | 401 | `{ "status": "UNAUTHORIZED", "code": "INVALID_API_KEY", "message": "Invalid or missing API key" }` |

Los mensajes de respuesta de la API están en inglés; el resto de la documentación, en español.

### 8.5 Persistencia (BD propia de la pasarela)

Se guarda **cada intento** como trazabilidad, en una tabla `payment_attempts`:

| Campo | Notas |
|---|---|
| `id`, `transaction_id` | |
| `reservation_id`, `attempt_number` | `attempt_number` es por `(reservation_id, card_fingerprint)` |
| `card_fingerprint` | HMAC-SHA256 del número con una clave secreta propia de la pasarela (`CARD_FINGERPRINT_SECRET`); sirve para agrupar intentos sin guardar el número |
| `card_brand` | `VISA`, `MASTERCARD` o `AMEX` |
| `card_last4`, `amount` | |
| `status` | `APPROVED`, `REJECTED`, `ERROR`, `CARD_FLAGGED` |
| `error_code`, `created_at` | |

Nunca se guarda el número completo, el CVV ni la fecha de vencimiento.

| Regla | Descripción |
|---|---|
| RN-PAY-1 | Todo intento válido se guarda con su resultado. Los de formato inválido (`400`) no se guardan, porque no llegan a ser un intento de cobro. |
| RN-PAY-2 | Idempotencia: si ya existe un intento `APPROVED` para el `reservationId`, la pasarela devuelve ese resultado sin cobrar de nuevo. Una restricción de la BD garantiza un solo `APPROVED` por reserva, incluso con solicitudes concurrentes. |
| RN-PAY-3 | La escritura ocurre después de decidir el resultado; no lo condiciona. |

### 8.6 Seguridad (API key entre servicios)

Para el MVP, `ticket-api` se autentica ante la pasarela con una **API key estática**.

```
ticket-api --POST /payments--> payment-gateway
            Authorization: Bearer <api-key>
                  |
                  +-- falta o no coincide --> 401, sin procesar
```

| Regla | Descripción |
|---|---|
| RN-PAY-4 | Todo request a `/payments` exige `Authorization: Bearer <api-key>`. |
| RN-PAY-5 | Sin header o con key inválida, la pasarela responde `401` `INVALID_API_KEY` antes de validar nada, y no guarda ningún intento. Solo el endpoint de salud (`/actuator/health`) queda sin key. |
| RN-PAY-6 | La key se compara en tiempo constante, nunca se registra en logs y fuera de local solo se transmite por HTTPS. |
| RN-PAY-7 | `ticket-api` guarda la key en una variable de entorno (`PAYMENT_GATEWAY_API_KEY`) y la URL de la pasarela en `PAYMENT_GATEWAY_URL`, nunca en el código ni en el repo. La pasarela usa su propia variable `PAYMENT_GATEWAY_API_KEY` con el mismo valor. |
| RN-PAY-8 | Si la pasarela responde `401`, `ticket-api` lo trata como error de configuración: no emite ticket, la reserva sigue `ACTIVE`, registra el incidente y muestra al usuario un error genérico. |

**Etapa futura (iteración siguiente, fuera del MVP)**

| Mejora | Descripción |
|---|---|
| Endpoint de emisión de token | La pasarela expone `POST /auth/token` donde `ticket-api` se autentica con `client_id` y `client_secret` y recibe un token (modelo client credentials). |
| Expiración del token | El token tiene vida corta (ej. 15 min) y `ticket-api` lo renueva antes de que venza. Un token vencido responde `401` `TOKEN_EXPIRED`. |
| Rotación de credenciales | Dos secretos válidos a la vez durante el cambio, para rotar sin caída. |
| Restricción por origen | Lista de IPs permitidas. |

### 8.7 Reacción de `ticket-api` a cada respuesta

| Respuesta de la pasarela | Qué hace `ticket-api` | Qué recibe el usuario |
|---|---|---|
| 200 `APPROVED` | Emite el ticket, seat `SOLD`, reserva `CONFIRMED` (si el evento sigue `ACTIVE`, RN-TKT-7) | Ticket emitido |
| 402 `REJECTED` | No emite ticket; la reserva sigue `ACTIVE` | Pago rechazado: puede intentar con otra tarjeta |
| 502 `ERROR` | No emite ticket; la reserva sigue `ACTIVE` | Error temporal: puede reintentar con la misma tarjeta |
| 422 `CARD_FLAGGED` | No emite ticket; la reserva sigue `ACTIVE` | La tarjeta presenta problemas: debe usar otra |
| 400 | No emite ticket; la reserva sigue `ACTIVE` | Datos de tarjeta inválidos, con el `message` de la pasarela |
| 401 | Error de configuración (RN-PAY-8) | Error genérico |
| Timeout (5 s) o sin conexión | RN-TKT-8; sin reintento automático (RN-TKT-11) | Error temporal: puede reintentar |

`ticket-api` decide por el código HTTP: `5xx` o timeout es reintentable, `402` y `422` piden otra tarjeta, `400` pide corregir los datos.

## 9. Cambios OpenSpec sugeridos (orden)

1. `auth-users`
2. `events-seats`
3. `reservations`
4. `event-cancellation`
5. `ticket-purchase` (incluye el cliente HTTP y el timeout)

La pasarela se planea en su propio repositorio (cambio OpenSpec `payment-gateway`, 25 tareas en 4 iteraciones) y no genera cambio en este repo. En `ticket-purchase` se usa un mock del contrato de la sección 8 para probar, hasta que la pasarela esté disponible.

## 10. Supuestos que hay que confirmar

- El seed del primer `ADMIN` usa credenciales de variables de entorno; cambiar la contraseña de un usuario existente queda fuera del MVP.
- Capacidad máxima de 260 por evento (filas `A..Z` de 10 puestos). Se puede subir con filas dobles (`AA`, `AB`...) si hace falta.
- Tras `CARD_FLAGGED` la reserva no se cancela; el usuario puede pagar con otra tarjeta mientras dure el TTL.
- Los intentos se cuentan por reserva y tarjeta. Una tarjeta nueva empieza de nuevo en el intento 1.
- El `CARD_FLAGGED` no impide que la misma tarjeta se use en otra reserva (el conteo es por reserva). Un bloqueo global por tarjeta queda fuera del MVP.
- Confirmado: todos los intentos con formato válido se guardan en la pasarela, incluidos los `REJECTED` (`0000`).
- Confirmado: la franquicia solo se valida contra la lista `VISA`, `MASTERCARD`, `AMEX`; no se verifica contra el número ni se valida Luhn.

## 11. Convenciones del proyecto (confirmadas)

Aplican a `ticket-api` igual que a la pasarela:
- Código, nombres, mensajes de respuesta de la API, logs y tests en inglés.
- Documentos (OpenSpec, README, `docs/`) y comentarios necesarios en el código en español.
- Estructura por capas: controller, service, repository y model, con las mismas reglas de dependencia que la pasarela. Sin literales de negocio en service ni controller.
- Pruebas unitarias, de integración con base de datos real (no en memoria) y pruebas de arquitectura que hagan cumplir las capas.

## 12. Decisiones técnicas y pendientes

Definido (detalle en `docs/architecture.md`):
- `ticket-api`: Node 22, Express 5, TypeScript, pnpm, Kysely + PostgreSQL, Docker, estructura por módulos.
- Pasarela: Java 21, Spring Boot, Gradle, PostgreSQL y Docker.
- Expiración de reservas: `expires_at`, liberación lazy y job de 60 s.
- Llamada a la pasarela: timeout de 5 s y sin reintentos automáticos.

Pendiente:
- Crear los cambios OpenSpec de `ticket-api` (orden en la sección 9).
