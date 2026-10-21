## ADDED Requirements

### Requirement: Consulta de una reserva propia
El sistema SHALL exponer `GET /reservations/:id`, restringido al rol `USER`, que responde `200` con la reserva `{ id, eventId, seatId, seat, status, amount, expiresAt, createdAt }`, en el mismo formato que `POST /reservations`. Solo el dueño de la reserva MAY consultarla. La consulta MUST NOT modificar la reserva ni el seat.

#### Scenario: Reserva vigente
- **WHEN** el dueño consulta una reserva `ACTIVE` que no ha vencido
- **THEN** el sistema responde `200` con `status` `ACTIVE`, la etiqueta del seat en `seat` (por ejemplo `C7`) y su `expiresAt`

#### Scenario: Reserva confirmada
- **WHEN** el dueño consulta una reserva ya pagada
- **THEN** el sistema responde `200` con `status` `CONFIRMED`

#### Scenario: Reserva cancelada por el evento
- **WHEN** el dueño consulta una reserva cuyo evento fue cancelado
- **THEN** el sistema responde `200` con `status` `CANCELLED`

#### Scenario: Consulta sin efectos
- **WHEN** se consulta una reserva
- **THEN** el estado guardado de la reserva y el de su seat no cambian

### Requirement: Estado efectivo de una reserva vencida
Cuando una reserva está guardada como `ACTIVE` pero su `expiresAt` ya pasó según la hora de la base de datos, `GET /reservations/:id` SHALL devolverla con `status` `EXPIRED`, aunque la liberación periódica todavía no la haya procesado.

#### Scenario: Vencida antes de que corra el job
- **WHEN** el dueño consulta una reserva `ACTIVE` cuyo `expiresAt` ya pasó y que el job aún no liberó
- **THEN** el sistema responde `200` con `status` `EXPIRED`

#### Scenario: Vencida y ya liberada
- **WHEN** el dueño consulta una reserva que el job ya marcó `EXPIRED`
- **THEN** el sistema responde `200` con `status` `EXPIRED`

### Requirement: Acceso a la consulta de reservas
El sistema MUST responder `401` con `code` `UNAUTHORIZED` sin token válido y `403` con `code` `FORBIDDEN` si el usuario no tiene rol `USER` o la reserva pertenece a otro usuario. Si la reserva no existe, MUST responder `404` con `code` `RESERVATION_NOT_FOUND`; si `id` no es un UUID, `400` con `code` `VALIDATION_ERROR`.

#### Scenario: Sin token
- **WHEN** se llama a `GET /reservations/:id` sin `Authorization`
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

#### Scenario: Reserva de otro usuario
- **WHEN** un `USER` consulta una reserva creada por otro usuario
- **THEN** el sistema responde `403` con `code` `FORBIDDEN` y no devuelve datos de la reserva

#### Scenario: ADMIN
- **WHEN** un `ADMIN` llama a `GET /reservations/:id`
- **THEN** el sistema responde `403` con `code` `FORBIDDEN`

#### Scenario: Reserva inexistente
- **WHEN** un `USER` consulta un UUID que no corresponde a ninguna reserva
- **THEN** el sistema responde `404` con `code` `RESERVATION_NOT_FOUND`

#### Scenario: Id inválido
- **WHEN** `id` no es un UUID
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`
