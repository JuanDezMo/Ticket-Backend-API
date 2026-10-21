# payment-gateway-client Specification

## Purpose

Define cómo `ticket-api` consume la pasarela de pagos externa: llamada autenticada, tiempo límite, una sola llamada por intento y traducción de cada respuesta del contrato a un resultado interno.

## Requirements

### Requirement: Llamada a la pasarela
El sistema SHALL enviar `POST {PAYMENT_GATEWAY_URL}/payments` con cuerpo JSON `{ reservationId, amount, card: { brand, number, expiry, cvv } }` y el header `Authorization: Bearer <PAYMENT_GATEWAY_API_KEY>`. El monto SHALL ser el de la reserva y `reservationId` el de la reserva.

#### Scenario: Contenido de la llamada
- **WHEN** se paga una reserva de monto 150000 con una tarjeta VISA
- **THEN** la pasarela recibe `reservationId`, `amount` 150000, la tarjeta con `brand` `VISA` y el header `Authorization` con la API key configurada

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
