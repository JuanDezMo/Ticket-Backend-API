## MODIFIED Requirements

### Requirement: Reserva inexistente o no pagable
El sistema MUST responder `404` con `code` `RESERVATION_NOT_FOUND` si la reserva no existe, `409` con `code` `EVENT_CANCELLED` si su evento está cancelado, `409` con `code` `RESERVATION_ALREADY_CANCELLED` si su dueño la canceló (`CANCELLED_BY_USER`), y `409` con `code` `RESERVATION_EXPIRED` si la reserva no está `ACTIVE` por otra causa o su `expiresAt` ya pasó (según la hora de la base de datos). En esos casos no se llama a la pasarela.

#### Scenario: Reserva desconocida
- **WHEN** `reservationId` es un UUID que no corresponde a ninguna reserva
- **THEN** el sistema responde `404` con `code` `RESERVATION_NOT_FOUND`

#### Scenario: Reserva vencida
- **WHEN** la reserva tiene `expiresAt` en el pasado, aunque el job no la haya liberado aún
- **THEN** el sistema responde `409` con `code` `RESERVATION_EXPIRED` y no llama a la pasarela

#### Scenario: Reserva cancelada o expirada
- **WHEN** la reserva está `EXPIRED` o `CANCELLED`
- **THEN** el sistema responde `409` con `code` `RESERVATION_EXPIRED`

#### Scenario: Reserva cancelada por el usuario
- **WHEN** la reserva está `CANCELLED_BY_USER`
- **THEN** el sistema responde `409` con `code` `RESERVATION_ALREADY_CANCELLED` y no llama a la pasarela

#### Scenario: Evento cancelado
- **WHEN** el evento de la reserva está `CANCELLED`
- **THEN** el sistema responde `409` con `code` `EVENT_CANCELLED` y no llama a la pasarela

### Requirement: Compra en vuelo
Tras la aprobación, el sistema SHALL verificar dentro de la misma transacción, con el evento bloqueado contra cancelaciones simultáneas, que el evento siga `ACTIVE` y que la reserva siga `ACTIVE`. Si el evento fue cancelado, MUST responder `409` con `code` `EVENT_CANCELLED`; si el dueño canceló la reserva, `409` con `code` `RESERVATION_ALREADY_CANCELLED`; si la reserva dejó de estar activa por otra causa, `409` con `code` `RESERVATION_EXPIRED`. En todos los casos MUST NOT emitir ticket y MUST registrar el pago aprobado como `REFUND_PENDING`.

#### Scenario: Evento cancelado durante el pago
- **WHEN** el evento se cancela después de iniciar el pago y la pasarela aprueba
- **THEN** el sistema responde `409` con `code` `EVENT_CANCELLED`, no hay ticket y existe un pago `REFUND_PENDING` con el `transactionId`

#### Scenario: Reserva liberada durante el pago
- **WHEN** la reserva queda `EXPIRED` mientras se paga y la pasarela aprueba
- **THEN** el sistema responde `409` con `code` `RESERVATION_EXPIRED`, no hay ticket y existe un pago `REFUND_PENDING`

#### Scenario: Reserva cancelada por el usuario durante el pago
- **WHEN** el dueño cancela la reserva mientras se paga y la pasarela aprueba
- **THEN** el sistema responde `409` con `code` `RESERVATION_ALREADY_CANCELLED`, no hay ticket, existe un pago `REFUND_PENDING` y el seat queda `AVAILABLE`

#### Scenario: Cancelación simultánea a la compra
- **WHEN** una compra aprobada y la cancelación del evento ocurren a la vez
- **THEN** el resultado es consistente: o el ticket se emite y luego queda `CANCELLED_BY_EVENT` con su pago `REFUND_PENDING`, o no se emite ticket y el pago queda `REFUND_PENDING`
