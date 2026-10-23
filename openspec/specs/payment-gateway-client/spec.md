# payment-gateway-client Specification

## Purpose

Define cómo `ticket-api` consume la pasarela de pagos externa: llamada autenticada, tiempo límite, una sola llamada por intento y traducción de cada respuesta del contrato a un resultado interno.

## Requirements

### Requirement: Llamada a la pasarela
El sistema SHALL enviar `POST {PAYMENT_GATEWAY_URL}/payments` con cuerpo JSON `{ reservationId, amount, card: { brand, number, expiry, cvv } }` y el header `Authorization: Bearer <PAYMENT_GATEWAY_API_KEY>`, **una sola vez por compra**, sea cual sea el número de reservas. El monto SHALL ser el total del pedido (la suma de sus reservas). Como el contrato de la pasarela identifica el pago por `reservationId` y su idempotencia es solo por ese id (devuelve el mismo `transactionId` aunque cambien el monto o la tarjeta), SHALL enviarse como `reservationId` un identificador del conjunto exacto de reservas: el id de la reserva cuando es una sola y, cuando son varias, un UUID determinista (versión 5, con un espacio de nombres fijo) calculado sobre los ids ordenados. El mismo conjunto MUST producir siempre el mismo identificador, sin importar el orden de la solicitud, y dos conjuntos distintos MUST NOT compartirlo.

#### Scenario: Contenido de la llamada
- **WHEN** se paga una reserva de monto 150000 con una tarjeta VISA
- **THEN** la pasarela recibe `reservationId`, `amount` 150000, la tarjeta con `brand` `VISA` y el header `Authorization` con la API key configurada

#### Scenario: Compra de varias reservas
- **WHEN** se pagan tres reservas de 150000 cada una
- **THEN** la pasarela recibe una sola llamada con `amount` 450000 y como `reservationId` un UUID determinista del conjunto de los tres ids

#### Scenario: Nuevo intento con el mismo conjunto
- **WHEN** el usuario vuelve a pagar las mismas reservas tras un error de la pasarela
- **THEN** la pasarela recibe el mismo `reservationId` que en el intento anterior

#### Scenario: Una sola reserva
- **WHEN** se paga una sola reserva
- **THEN** la pasarela recibe como `reservationId` el id de esa reserva

#### Scenario: El orden de la solicitud no cambia el identificador
- **WHEN** se pagan las mismas tres reservas en dos solicitudes con los ids en distinto orden
- **THEN** la pasarela recibe el mismo `reservationId` en ambas

#### Scenario: Conjuntos que comparten una reserva
- **WHEN** se paga el conjunto {A, B} y después el conjunto {A, C}
- **THEN** la pasarela recibe un `reservationId` distinto para cada uno y el segundo se cobra

### Requirement: Tiempo límite
El sistema MUST cancelar la llamada si la pasarela no responde dentro de `PAYMENT_GATEWAY_TIMEOUT_MS` (5000 ms por defecto) y tratarla como timeout.

#### Scenario: Pasarela lenta
- **WHEN** la pasarela tarda más que el tiempo límite configurado
- **THEN** el resultado es timeout y la compra responde `504` con `code` `PAYMENT_GATEWAY_TIMEOUT`

### Requirement: Traducción de respuestas
El sistema SHALL traducir las respuestas de la pasarela a resultados internos: `200` con `status` `APPROVED` y `transactionId` → aprobado; `402` → rechazado; `422` → tarjeta con problemas; `502` → error de la pasarela; `400` con `code` `BRAND_NOT_ALLOWED` → franquicia no permitida; `400` con otro `code` → datos inválidos con su mensaje; `401` → configuración inválida. Cualquier otra respuesta, un cuerpo ilegible o un `200` sin `transactionId` MUST tratarse como error de la pasarela. Un fallo de conexión MUST tratarse como error de la pasarela (`502`), no como timeout.

#### Scenario: Respuesta inesperada
- **WHEN** la pasarela responde `500` con un cuerpo que no es JSON
- **THEN** el resultado es error de la pasarela y la compra responde `502` con `code` `PAYMENT_GATEWAY_ERROR`

#### Scenario: Aprobado sin transactionId
- **WHEN** la pasarela responde `200` con `status` `APPROVED` pero sin `transactionId`
- **THEN** el resultado es error de la pasarela y no se emite ticket

#### Scenario: Pasarela inalcanzable
- **WHEN** no se puede conectar con la pasarela
- **THEN** la compra responde `502` con `code` `PAYMENT_GATEWAY_ERROR`

### Requirement: Secretos y datos de tarjeta fuera de los logs
El sistema MUST NOT escribir en logs ni exponer en respuestas la API key de la pasarela ni los datos de tarjeta, tampoco en los errores de la llamada.

#### Scenario: Fallo de la llamada
- **WHEN** la llamada a la pasarela falla
- **THEN** los logs y la respuesta no contienen la API key, el número, el vencimiento ni el CVV
