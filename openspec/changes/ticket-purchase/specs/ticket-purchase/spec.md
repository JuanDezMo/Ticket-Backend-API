## Purpose

Permite a un usuario pagar una reserva vigente y obtener su ticket, de forma idempotente y consistente con el estado del evento, la reserva y el seat.

## ADDED Requirements

### Requirement: Comprar una reserva
El sistema SHALL exponer `POST /tickets/purchase`, restringido al rol `USER`, que recibe `reservationId` y `card` (`brand`, `number`, `expiry`, `cvv`). Cuando la pasarela aprueba el pago, SHALL responder `201` con `{ id, reservationId, eventId, seat, status, amount, transactionId, issuedAt }` con `status` `ISSUED`, pasar el seat a `SOLD` y la reserva a `CONFIRMED`. El monto cobrado MUST ser el de la reserva (el precio del evento) y nunca un valor enviado por el cliente.

#### Scenario: Compra exitosa
- **WHEN** un USER paga con una tarjeta aprobada una reserva suya vigente
- **THEN** el sistema responde `201` con el ticket `ISSUED`, el `amount` de la reserva y el `transactionId` de la pasarela; el seat queda `SOLD` y la reserva `CONFIRMED`

#### Scenario: Monto enviado por el cliente
- **WHEN** la solicitud incluye un campo `amount`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y no llama a la pasarela

### Requirement: Acceso restringido
El sistema MUST responder `401` con `code` `UNAUTHORIZED` si no hay token válido y `403` con `code` `FORBIDDEN` si el usuario no es `USER` o la reserva pertenece a otro usuario.

#### Scenario: Reserva de otro usuario
- **WHEN** un USER intenta pagar la reserva de otro USER
- **THEN** el sistema responde `403` con `code` `FORBIDDEN`, no llama a la pasarela y no modifica nada

#### Scenario: ADMIN intenta comprar
- **WHEN** un ADMIN llama a `POST /tickets/purchase`
- **THEN** el sistema responde `403` con `code` `FORBIDDEN`

#### Scenario: Sin token
- **WHEN** se llama sin `Authorization`
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

### Requirement: Validación de la solicitud
El sistema SHALL exigir `reservationId` como UUID y `card.number`, `card.expiry` y `card.cvv` como textos no vacíos, y MUST responder `400` con `code` `VALIDATION_ERROR` si falta alguno o hay campos adicionales. La validación del formato del número, el vencimiento y el CVV corresponde a la pasarela.

#### Scenario: reservationId inválido
- **WHEN** `reservationId` es `abc`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Falta un dato de tarjeta
- **WHEN** el cuerpo no incluye `card.cvv`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y no llama a la pasarela

### Requirement: Franquicia obligatoria
El sistema SHALL exigir `card.brand` y validarla antes de llamar a la pasarela, sin llamada ni cobro si falla. Si el campo está ausente, es nulo o vacío, MUST responder `400` con `code` `CARD_BRAND_REQUIRED` y el mensaje "Card brand is required. Use VISA, MASTERCARD or AMEX". Si su valor no es `VISA`, `MASTERCARD` ni `AMEX` (sin distinguir mayúsculas), MUST responder `400` con `code` `CARD_BRAND_NOT_ALLOWED` y el mensaje "Card brand not allowed. Use VISA, MASTERCARD or AMEX". A la pasarela se envía siempre en mayúsculas.

#### Scenario: Franquicia ausente
- **WHEN** el cuerpo no incluye `card.brand`
- **THEN** el sistema responde `400` con `code` `CARD_BRAND_REQUIRED` y ese mensaje, y la pasarela no recibe ninguna llamada

#### Scenario: Franquicia nula o vacía
- **WHEN** `card.brand` es `null` o una cadena vacía
- **THEN** el sistema responde `400` con `code` `CARD_BRAND_REQUIRED`

#### Scenario: Franquicia no permitida
- **WHEN** `card.brand` es `DINERS`
- **THEN** el sistema responde `400` con `code` `CARD_BRAND_NOT_ALLOWED` y ese mensaje, y la pasarela no recibe ninguna llamada

#### Scenario: Franquicia en minúscula
- **WHEN** `card.brand` es `visa`
- **THEN** el sistema la acepta y envía `VISA` a la pasarela

#### Scenario: La pasarela rechaza la franquicia
- **WHEN** la pasarela responde `400` con `BRAND_NOT_ALLOWED`
- **THEN** el sistema responde `400` con `code` `CARD_BRAND_NOT_ALLOWED`

### Requirement: Reserva inexistente o no pagable
El sistema MUST responder `404` con `code` `RESERVATION_NOT_FOUND` si la reserva no existe, `409` con `code` `EVENT_CANCELLED` si su evento está cancelado, y `409` con `code` `RESERVATION_EXPIRED` si la reserva no está `ACTIVE` o su `expiresAt` ya pasó (según la hora de la base de datos). En esos casos no se llama a la pasarela.

#### Scenario: Reserva desconocida
- **WHEN** `reservationId` es un UUID que no corresponde a ninguna reserva
- **THEN** el sistema responde `404` con `code` `RESERVATION_NOT_FOUND`

#### Scenario: Reserva vencida
- **WHEN** la reserva tiene `expiresAt` en el pasado, aunque el job no la haya liberado aún
- **THEN** el sistema responde `409` con `code` `RESERVATION_EXPIRED` y no llama a la pasarela

#### Scenario: Reserva cancelada o expirada
- **WHEN** la reserva está `EXPIRED` o `CANCELLED`
- **THEN** el sistema responde `409` con `code` `RESERVATION_EXPIRED`

#### Scenario: Evento cancelado
- **WHEN** el evento de la reserva está `CANCELLED`
- **THEN** el sistema responde `409` con `code` `EVENT_CANCELLED` y no llama a la pasarela

### Requirement: Pago no aprobado
Cuando la pasarela no aprueba el pago, el sistema MUST NOT emitir el ticket y la reserva y el seat MUST permanecer como estaban (`ACTIVE` y `RESERVED`), de modo que el usuario pueda reintentar mientras dure la reserva. Respuestas: pago rechazado → `402` `PAYMENT_REJECTED`; tarjeta con problemas → `422` `CARD_PROBLEM`; error de la pasarela → `502` `PAYMENT_GATEWAY_ERROR`; timeout → `504` `PAYMENT_GATEWAY_TIMEOUT`; datos de tarjeta inválidos → `400` `VALIDATION_ERROR` con el mensaje de la pasarela; API key rechazada por la pasarela → `500` `INTERNAL_ERROR` con mensaje genérico.

#### Scenario: Pago rechazado
- **WHEN** la pasarela responde `402`
- **THEN** el sistema responde `402` con `code` `PAYMENT_REJECTED`, no hay ticket y la reserva sigue `ACTIVE`

#### Scenario: Tarjeta con problemas
- **WHEN** la pasarela responde `422`
- **THEN** el sistema responde `422` con `code` `CARD_PROBLEM`

#### Scenario: Error de la pasarela
- **WHEN** la pasarela responde `502`
- **THEN** el sistema responde `502` con `code` `PAYMENT_GATEWAY_ERROR`, y el usuario puede reintentar

#### Scenario: Timeout
- **WHEN** la pasarela no responde dentro del tiempo límite
- **THEN** el sistema responde `504` con `code` `PAYMENT_GATEWAY_TIMEOUT` y la reserva sigue `ACTIVE`

#### Scenario: Datos de tarjeta inválidos
- **WHEN** la pasarela responde `400` por formato inválido
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y el mensaje de la pasarela

#### Scenario: Configuración inválida
- **WHEN** la pasarela responde `401`
- **THEN** el sistema responde `500` con `code` `INTERNAL_ERROR` y mensaje genérico, sin exponer la API key, y registra el incidente

### Requirement: Sin reintentos automáticos
El sistema MUST realizar una sola llamada a la pasarela por solicitud de compra, sea cual sea la respuesta (incluidos `502` y timeout). El reintento lo inicia el usuario.

#### Scenario: Error de la pasarela
- **WHEN** la pasarela responde `502`
- **THEN** la pasarela recibió exactamente una llamada

### Requirement: Idempotencia de la compra
Repetir la compra de una reserva que ya tiene ticket MUST devolver ese mismo ticket con `200`, sin llamar de nuevo a la pasarela y sin crear otro ticket ni otro pago. Ante solicitudes simultáneas para la misma reserva, MUST existir un único ticket y un único pago.

#### Scenario: Compra repetida
- **WHEN** el dueño vuelve a comprar una reserva ya pagada
- **THEN** el sistema responde `200` con el mismo ticket y no hay llamadas nuevas a la pasarela

#### Scenario: Solicitudes simultáneas
- **WHEN** varias solicitudes pagan a la vez la misma reserva
- **THEN** existe un solo ticket y un solo pago, y todas las respuestas exitosas devuelven el mismo `id` de ticket

### Requirement: Compra en vuelo
Tras la aprobación, el sistema SHALL verificar dentro de la misma transacción, con el evento bloqueado contra cancelaciones simultáneas, que el evento siga `ACTIVE` y que la reserva siga `ACTIVE`. Si el evento fue cancelado, MUST responder `409` con `code` `EVENT_CANCELLED`; si la reserva dejó de estar activa, `409` con `code` `RESERVATION_EXPIRED`. En ambos casos MUST NOT emitir ticket y MUST registrar el pago aprobado como `REFUND_PENDING`.

#### Scenario: Evento cancelado durante el pago
- **WHEN** el evento se cancela después de iniciar el pago y la pasarela aprueba
- **THEN** el sistema responde `409` con `code` `EVENT_CANCELLED`, no hay ticket y existe un pago `REFUND_PENDING` con el `transactionId`

#### Scenario: Reserva liberada durante el pago
- **WHEN** la reserva queda `EXPIRED` mientras se paga y la pasarela aprueba
- **THEN** el sistema responde `409` con `code` `RESERVATION_EXPIRED`, no hay ticket y existe un pago `REFUND_PENDING`

#### Scenario: Cancelación simultánea a la compra
- **WHEN** una compra aprobada y la cancelación del evento ocurren a la vez
- **THEN** el resultado es consistente: o el ticket se emite y luego queda `CANCELLED_BY_EVENT` con su pago `REFUND_PENDING`, o no se emite ticket y el pago queda `REFUND_PENDING`

### Requirement: Datos de tarjeta no persistidos ni registrados
El sistema MUST NOT guardar en la base de datos ni escribir en los logs el número de tarjeta, el vencimiento ni el CVV, ni siquiera ante errores.

#### Scenario: Compra con error
- **WHEN** una compra falla por un error de la pasarela
- **THEN** ni la base de datos ni los logs contienen el número, el vencimiento ni el CVV de la tarjeta

### Requirement: Registro de pagos y tickets
Una compra aprobada SHALL guardar un pago `APPROVED` con `transactionId` y monto y un ticket `ISSUED` asociado, de forma atómica con el cambio de estado del seat y la reserva. Cada reserva tiene como máximo un ticket y un pago. Si la emisión falla por un error inesperado después del cobro, el sistema MUST revertir el cambio de estado del seat y la reserva, responder `500` con `code` `INTERNAL_ERROR`, y dejar el pago registrado como `REFUND_PENDING` (el cobro ya ocurrió) para no perder su rastro.

#### Scenario: Atomicidad del cambio de estado
- **WHEN** falla la inserción del ticket después de confirmar la reserva
- **THEN** la reserva sigue `ACTIVE`, el seat `RESERVED` y no existe ningún ticket

#### Scenario: El cobro no se pierde
- **WHEN** la emisión falla después de que la pasarela aprobó
- **THEN** existe un pago `REFUND_PENDING` con el `transactionId` y el sistema responde `500` con `code` `INTERNAL_ERROR`
