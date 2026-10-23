## ADDED Requirements

### Requirement: Pedido de una compra
Cada compra aprobada SHALL crear un pedido con el usuario, el evento y el monto total (la suma de los montos de sus reservas, calculada por el servidor). El pedido SHALL tener un único pago y un ticket por cada reserva, y las reservas pagadas SHALL quedar asociadas a él. Todas las reservas de un pedido MUST ser del mismo usuario y del mismo evento.

#### Scenario: Monto del pedido
- **WHEN** un USER paga tres reservas de 150000 cada una
- **THEN** el pedido tiene `amount` 450000, un solo pago por ese monto y tres tickets de 150000

#### Scenario: Reservas de eventos distintos
- **WHEN** la solicitud incluye reservas de dos eventos distintos
- **THEN** el sistema responde `400` con `code` `RESERVATIONS_MISMATCH`, no llama a la pasarela y no modifica nada

#### Scenario: Una sola reserva
- **WHEN** se paga una sola reserva
- **THEN** se crea un pedido con esa reserva y un ticket

### Requirement: Pago en curso
Antes de llamar a la pasarela, el sistema SHALL reclamar todas las reservas de la compra de forma atómica. Si alguna ya tiene un pago en curso (reclamada hace menos de `PAYMENT_CLAIM_SECONDS`, 30 por defecto), MUST responder `409` con `code` `PAYMENT_IN_PROGRESS` y el mensaje "Your payment is being processed. Try again in a few seconds", sin llamar a la pasarela y sin reclamar ninguna. Esto aplica también a conjuntos que se solapan parcialmente. El reclamo SHALL liberarse cuando el pago termina sin ticket por rechazo (`PAYMENT_REJECTED`), tarjeta con problemas (`CARD_PROBLEM`), error de la pasarela (`PAYMENT_GATEWAY_ERROR`), datos inválidos o configuración inválida, de modo que el usuario pueda hacer un nuevo intento de inmediato. Tras un timeout (`PAYMENT_GATEWAY_TIMEOUT`) SHALL mantenerse hasta vencer por tiempo, porque el resultado del cobro es desconocido. Si el proceso se interrumpe, el reclamo vence solo. `PAYMENT_CLAIM_SECONDS` MUST ser mayor que el tiempo límite de la pasarela.

#### Scenario: Dos solicitudes simultáneas
- **WHEN** dos solicitudes pagan a la vez las mismas reservas
- **THEN** exactamente una llama a la pasarela y responde según su resultado, y la otra responde `409` con `code` `PAYMENT_IN_PROGRESS` sin llamar a la pasarela

#### Scenario: Conjuntos que se solapan
- **WHEN** una solicitud paga las reservas A y B y otra, a la vez, las B y C
- **THEN** la segunda responde `409` con `code` `PAYMENT_IN_PROGRESS` y la reserva C no queda reclamada

#### Scenario: Nuevo intento tras un rechazo
- **WHEN** el pago es rechazado y el usuario intenta pagar de nuevo de inmediato con otra tarjeta
- **THEN** el nuevo intento no recibe `PAYMENT_IN_PROGRESS`

#### Scenario: Nuevo intento tras un timeout
- **WHEN** la pasarela agota el tiempo límite y el usuario intenta pagar de nuevo antes de `PAYMENT_CLAIM_SECONDS`
- **THEN** el sistema responde `409` con `code` `PAYMENT_IN_PROGRESS` sin llamar a la pasarela

#### Scenario: Reclamo vencido
- **WHEN** pasaron más de `PAYMENT_CLAIM_SECONDS` desde un reclamo que nunca se liberó
- **THEN** el usuario puede pagar de nuevo

#### Scenario: Configuración incoherente
- **WHEN** `PAYMENT_CLAIM_SECONDS` es menor o igual que el tiempo límite de la pasarela
- **THEN** el sistema no arranca y reporta la variable inválida

### Requirement: Monto máximo del pedido
El total del pedido (la suma de los montos de sus reservas) MUST NOT superar 9.999.999.999,99, el máximo que aceptan la pasarela y el campo de monto del pedido. Si lo supera, el sistema MUST responder `400` con `code` `ORDER_AMOUNT_TOO_LARGE` y el mensaje "The order total exceeds the maximum allowed. Pay fewer seats at once", antes de reclamar las reservas y sin llamar a la pasarela. La comprobación se hace tras validar que las reservas se pueden pagar.

#### Scenario: Total en el máximo
- **WHEN** un USER paga tres reservas de 3.333.333.333,33 cada una (total 9.999.999.999,99)
- **THEN** la compra se procesa con normalidad

#### Scenario: Una reserva en el precio máximo
- **WHEN** un USER paga una reserva de 9.999.999.999,99
- **THEN** la compra se procesa con normalidad

#### Scenario: Total por encima del máximo
- **WHEN** un USER paga dos reservas de 5.000.000.000,00 (total 10.000.000.000,00)
- **THEN** el sistema responde `400` con `code` `ORDER_AMOUNT_TOO_LARGE`, no llama a la pasarela y las reservas siguen `ACTIVE` sin reclamo

#### Scenario: Cuenta exacta
- **WHEN** las reservas suman 0,01 por cada una de 8 seats
- **THEN** el total es 0,08, sin errores de redondeo

### Requirement: Todo o nada en la compra
Si alguna de las reservas no se puede pagar, el sistema MUST rechazar la compra completa sin llamar a la pasarela, sin cobrar y sin modificar ninguna reserva ni seat. El sistema MUST NOT emitir tickets parciales.

#### Scenario: Una reserva del grupo vencida
- **WHEN** una de tres reservas ya venció
- **THEN** el sistema responde `409` con `code` `RESERVATION_EXPIRED`, no llama a la pasarela y las otras dos siguen `ACTIVE`

#### Scenario: Reservas repetidas
- **WHEN** `reservationIds` incluye dos veces el mismo id
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y no llama a la pasarela

## RENAMED Requirements

- FROM: `### Requirement: Comprar una reserva`
- TO: `### Requirement: Comprar reservas`
- FROM: `### Requirement: Idempotencia de la compra`
- TO: `### Requirement: Compra duplicada`

## MODIFIED Requirements

### Requirement: Comprar reservas
El sistema SHALL exponer `POST /tickets/purchase`, restringido al rol `USER`, que recibe `reservationIds` (una lista de 1 a 8 reservas) y `card` (`brand`, `number`, `expiry`, `cvv`). Cuando la pasarela aprueba el pago, SHALL responder `201` con `{ orderId, amount, tickets: [...] }`, donde cada ticket es `{ id, reservationId, eventId, seat, status, amount, transactionId, issuedAt }` con `status` `ISSUED`, en el mismo orden de la solicitud; SHALL pasar cada seat a `SOLD` y cada reserva a `CONFIRMED`. La respuesta siempre es una lista, incluso con una sola reserva. El monto cobrado MUST ser la suma de las reservas (el precio del evento por cada una) y nunca un valor enviado por el cliente.

#### Scenario: Compra exitosa
- **WHEN** un USER paga con una tarjeta aprobada una reserva suya vigente
- **THEN** el sistema responde `201` con `tickets` de un elemento `ISSUED`, el `amount` de la reserva y el `transactionId` de la pasarela; el seat queda `SOLD` y la reserva `CONFIRMED`

#### Scenario: Compra de varias reservas
- **WHEN** un USER paga tres reservas suyas vigentes con una tarjeta aprobada
- **THEN** el sistema responde `201` con tres tickets y el `amount` total, la pasarela recibe una sola llamada y los tres seats quedan `SOLD`

#### Scenario: Monto enviado por el cliente
- **WHEN** la solicitud incluye un campo `amount`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y no llama a la pasarela

### Requirement: Acceso restringido
El sistema MUST responder `401` con `code` `UNAUTHORIZED` si no hay token válido y `403` con `code` `FORBIDDEN` si el usuario no es `USER` o si alguna de las reservas pertenece a otro usuario. La pertenencia se valida antes que cualquier otro estado de las reservas.

#### Scenario: Reserva de otro usuario
- **WHEN** un USER intenta pagar, solo o junto a las suyas, la reserva de otro USER
- **THEN** el sistema responde `403` con `code` `FORBIDDEN`, no llama a la pasarela y no modifica nada

#### Scenario: ADMIN intenta comprar
- **WHEN** un ADMIN llama a `POST /tickets/purchase`
- **THEN** el sistema responde `403` con `code` `FORBIDDEN`

#### Scenario: Sin token
- **WHEN** se llama sin `Authorization`
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

### Requirement: Validación de la solicitud
El sistema SHALL exigir `reservationIds` como una lista de 1 a 8 UUID sin repetidos y `card.number`, `card.expiry` y `card.cvv` como textos no vacíos, y MUST responder `400` con `code` `VALIDATION_ERROR` si falta alguno o hay campos adicionales, incluido el campo antiguo `reservationId`. Si falta `reservationIds`, el mensaje SHALL indicar que es obligatorio ("reservationIds: is required"). La validación del formato del número, el vencimiento y el CVV corresponde a la pasarela.

#### Scenario: reservationId inválido
- **WHEN** algún elemento de `reservationIds` es `abc`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Falta un dato de tarjeta
- **WHEN** el cuerpo no incluye `card.cvv`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y no llama a la pasarela

#### Scenario: Campo antiguo reservationId
- **WHEN** el cuerpo incluye `reservationId` en lugar de `reservationIds`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y un mensaje que indica que `reservationIds` es obligatorio

#### Scenario: Lista vacía o demasiado larga
- **WHEN** `reservationIds` está vacía o tiene 9 elementos
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

### Requirement: Reserva inexistente o no pagable
El sistema MUST responder `404` con `code` `RESERVATION_NOT_FOUND` si alguna reserva no existe, `409` con `code` `EVENT_CANCELLED` si su evento está cancelado, `409` con `code` `RESERVATION_ALREADY_CANCELLED` si su dueño la canceló (`CANCELLED_BY_USER`), y `409` con `code` `RESERVATION_EXPIRED` si alguna reserva no está `ACTIVE` por otra causa o su `expiresAt` ya pasó (según la hora de la base de datos). Una reserva ya pagada (`CONFIRMED`) no entra aquí: se rechaza como compra duplicada. Se informa el primer problema, recorriendo las reservas en el orden de la solicitud. En esos casos no se llama a la pasarela.

#### Scenario: Reserva desconocida
- **WHEN** algún id de `reservationIds` es un UUID que no corresponde a ninguna reserva
- **THEN** el sistema responde `404` con `code` `RESERVATION_NOT_FOUND`

#### Scenario: Reserva vencida
- **WHEN** alguna reserva tiene `expiresAt` en el pasado, aunque el job no la haya liberado aún
- **THEN** el sistema responde `409` con `code` `RESERVATION_EXPIRED` y no llama a la pasarela

#### Scenario: Reserva cancelada o expirada
- **WHEN** alguna reserva está `EXPIRED` o `CANCELLED`
- **THEN** el sistema responde `409` con `code` `RESERVATION_EXPIRED`

#### Scenario: Reserva cancelada por el usuario
- **WHEN** alguna reserva está `CANCELLED_BY_USER`
- **THEN** el sistema responde `409` con `code` `RESERVATION_ALREADY_CANCELLED` y no llama a la pasarela

#### Scenario: Evento cancelado
- **WHEN** el evento de las reservas está `CANCELLED`
- **THEN** el sistema responde `409` con `code` `EVENT_CANCELLED` y no llama a la pasarela

### Requirement: Pago no aprobado
Cuando la pasarela no aprueba el pago, el sistema MUST NOT emitir ningún ticket ni crear el pedido, y todas las reservas y seats MUST permanecer como estaban (`ACTIVE` y `RESERVED`), de modo que el usuario pueda hacer un nuevo intento mientras dure la reserva. Respuestas: pago rechazado → `402` `PAYMENT_REJECTED`; tarjeta con problemas → `422` `CARD_PROBLEM`; error de la pasarela → `502` `PAYMENT_GATEWAY_ERROR`; timeout → `504` `PAYMENT_GATEWAY_TIMEOUT`; datos de tarjeta inválidos → `400` `VALIDATION_ERROR` con el mensaje de la pasarela; API key rechazada por la pasarela → `500` `INTERNAL_ERROR` con mensaje genérico.

#### Scenario: Pago rechazado
- **WHEN** la pasarela responde `402`
- **THEN** el sistema responde `402` con `code` `PAYMENT_REJECTED`, no hay tickets ni pedido y las reservas siguen `ACTIVE`

#### Scenario: Tarjeta con problemas
- **WHEN** la pasarela responde `422`
- **THEN** el sistema responde `422` con `code` `CARD_PROBLEM`

#### Scenario: Error de la pasarela
- **WHEN** la pasarela responde `502`
- **THEN** el sistema responde `502` con `code` `PAYMENT_GATEWAY_ERROR`, y el usuario puede hacer un nuevo intento

#### Scenario: Timeout
- **WHEN** la pasarela no responde dentro del tiempo límite
- **THEN** el sistema responde `504` con `code` `PAYMENT_GATEWAY_TIMEOUT` y las reservas siguen `ACTIVE`

#### Scenario: Datos de tarjeta inválidos
- **WHEN** la pasarela responde `400` por formato inválido
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y el mensaje de la pasarela

#### Scenario: Configuración inválida
- **WHEN** la pasarela responde `401`
- **THEN** el sistema responde `500` con `code` `INTERNAL_ERROR` y mensaje genérico, sin exponer la API key, y registra el incidente

### Requirement: Compra duplicada
Si alguna de las reservas de la solicitud ya está `CONFIRMED` (ya fue pagada), el sistema MUST responder `409` con `code` `DUPLICATE_PAYMENT` y el mensaje "These reservations were already paid. Check your tickets before paying again", sin llamar a la pasarela, sin crear otro pedido, otro pago ni otros tickets, y sin devolver los tickets existentes. Una solicitud que llega mientras otra del mismo conjunto todavía está cobrando recibe `PAYMENT_IN_PROGRESS`, no este error. Si, aun así, una solicitud cobra y al emitir encuentra reservas ya `CONFIRMED` (el reclamo venció durante un cobro lento), MUST responder `409` con `code` `DUPLICATE_PAYMENT` y, si el cobro tiene un `transactionId` distinto al del pedido existente, registrarlo como un pago `REFUND_PENDING` y dejar un aviso en el registro para conciliación.

#### Scenario: Compra repetida
- **WHEN** el dueño vuelve a comprar las mismas reservas ya pagadas
- **THEN** el sistema responde `409` con `code` `DUPLICATE_PAYMENT`, no hay llamadas nuevas a la pasarela y no se crean tickets ni pagos nuevos

#### Scenario: Solicitudes simultáneas
- **WHEN** varias solicitudes pagan a la vez las mismas reservas
- **THEN** exactamente una responde `201`, las demás `409` (`PAYMENT_IN_PROGRESS` mientras se cobra, `DUPLICATE_PAYMENT` si llegan cuando ya terminó), y existe un solo pedido, un solo pago y un ticket por reserva

#### Scenario: Reserva ya pagada junto a otras
- **WHEN** el usuario paga una reserva ya pagada junto con otra vigente
- **THEN** el sistema responde `409` con `code` `DUPLICATE_PAYMENT`, no llama a la pasarela y la reserva vigente sigue `ACTIVE`

#### Scenario: Doble cobro con reclamo vencido
- **WHEN** el reclamo venció durante un cobro lento, otra solicitud pagó y terminó, y la primera cobra con un `transactionId` distinto
- **THEN** el sistema responde `409` con `code` `DUPLICATE_PAYMENT`, registra un pago `REFUND_PENDING` por ese cobro y deja un aviso en el registro

### Requirement: Compra en vuelo
Tras la aprobación, el sistema SHALL verificar dentro de la misma transacción, con el evento bloqueado contra cancelaciones simultáneas y las reservas bloqueadas en un orden fijo por id, que el evento siga `ACTIVE` y que todas las reservas sigan `ACTIVE`. Si el evento fue cancelado, MUST responder `409` con `code` `EVENT_CANCELLED`; si el dueño canceló alguna reserva, `409` con `code` `RESERVATION_ALREADY_CANCELLED`; si alguna dejó de estar activa por otra causa, `409` con `code` `RESERVATION_EXPIRED`. En todos los casos MUST NOT emitir ningún ticket y MUST registrar el pago aprobado como `REFUND_PENDING`, una sola vez por compra, asociado a un pedido.

#### Scenario: Evento cancelado durante el pago
- **WHEN** el evento se cancela después de iniciar el pago y la pasarela aprueba
- **THEN** el sistema responde `409` con `code` `EVENT_CANCELLED`, no hay tickets y existe un único pago `REFUND_PENDING` con el `transactionId` y el monto total

#### Scenario: Reserva liberada durante el pago
- **WHEN** una de las reservas queda `EXPIRED` mientras se paga y la pasarela aprueba
- **THEN** el sistema responde `409` con `code` `RESERVATION_EXPIRED`, no hay tickets y existe un pago `REFUND_PENDING` por el monto total

#### Scenario: Reserva cancelada por el usuario durante el pago
- **WHEN** el dueño cancela una de las reservas mientras se paga y la pasarela aprueba
- **THEN** el sistema responde `409` con `code` `RESERVATION_ALREADY_CANCELLED`, no hay tickets, existe un pago `REFUND_PENDING` y el seat de la reserva cancelada queda `AVAILABLE`

#### Scenario: Cancelación simultánea a la compra
- **WHEN** una compra aprobada y la cancelación del evento ocurren a la vez
- **THEN** el resultado es consistente: o los tickets se emiten y luego quedan `CANCELLED_BY_EVENT` con su pago `REFUND_PENDING`, o no se emite ningún ticket y el pago queda `REFUND_PENDING`

#### Scenario: Sin interbloqueos
- **WHEN** dos compras con reservas en común se ejecutan a la vez, enviadas en distinto orden
- **THEN** ambas terminan sin interbloqueo: una se aprueba y la otra recibe `409`

### Requirement: Registro de pagos y tickets
Una compra aprobada SHALL guardar un pedido, un único pago `APPROVED` con `transactionId` y el monto total, y un ticket `ISSUED` por cada reserva, de forma atómica con el cambio de estado de los seats y las reservas. Cada reserva tiene como máximo un ticket y cada pedido un único pago. Si la emisión falla por un error inesperado después del cobro, el sistema MUST revertir el cambio de estado de los seats y las reservas, responder `500` con `code` `INTERNAL_ERROR`, y dejar el pago registrado como `REFUND_PENDING` (el cobro ya ocurrió) para no perder su rastro.

#### Scenario: Atomicidad del cambio de estado
- **WHEN** falla la inserción de un ticket después de confirmar las reservas
- **THEN** todas las reservas siguen `ACTIVE`, los seats `RESERVED` y no existe ningún ticket

#### Scenario: El cobro no se pierde
- **WHEN** la emisión falla después de que la pasarela aprobó
- **THEN** existe un pago `REFUND_PENDING` con el `transactionId` y el sistema responde `500` con `code` `INTERNAL_ERROR`
