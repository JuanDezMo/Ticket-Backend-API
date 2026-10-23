## MODIFIED Requirements

### Requirement: Llamada a la pasarela
El sistema SHALL enviar `POST {PAYMENT_GATEWAY_URL}/payments` con cuerpo JSON `{ reservationId, amount, card: { brand, number, expiry, cvv } }` y el header `Authorization: Bearer <PAYMENT_GATEWAY_API_KEY>`, **una sola vez por compra**, sea cual sea el número de reservas. El monto SHALL ser el total del pedido (la suma de sus reservas). Como el contrato de la pasarela identifica el pago por `reservationId`, SHALL enviarse como `reservationId` el id de menor valor de las reservas de la compra, que es estable ante los nuevos intentos del usuario con el mismo conjunto de reservas.

#### Scenario: Contenido de la llamada
- **WHEN** se paga una reserva de monto 150000 con una tarjeta VISA
- **THEN** la pasarela recibe `reservationId`, `amount` 150000, la tarjeta con `brand` `VISA` y el header `Authorization` con la API key configurada

#### Scenario: Compra de varias reservas
- **WHEN** se pagan tres reservas de 150000 cada una
- **THEN** la pasarela recibe una sola llamada con `amount` 450000 y como `reservationId` el menor de los tres ids

#### Scenario: Nuevo intento con el mismo conjunto
- **WHEN** el usuario vuelve a pagar las mismas reservas tras un error de la pasarela
- **THEN** la pasarela recibe el mismo `reservationId` que en el intento anterior
