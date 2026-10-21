## MODIFIED Requirements

### Requirement: Estados de la reserva
Una reserva SHALL tener uno de los estados `ACTIVE`, `EXPIRED`, `CONFIRMED`, `CANCELLED` o `CANCELLED_BY_USER`, y se crea siempre `ACTIVE`. `CANCELLED` lo deja la cancelación del evento y `CANCELLED_BY_USER` la cancelación por su dueño.

#### Scenario: Estado inicial
- **WHEN** se crea una reserva
- **THEN** su estado es `ACTIVE`

#### Scenario: Consulta de una reserva cancelada por el usuario
- **WHEN** el dueño consulta con `GET /reservations/:id` una reserva que canceló
- **THEN** el sistema responde `200` con `status` `CANCELLED_BY_USER`

## ADDED Requirements

### Requirement: Cancelación de una reserva por su dueño
El sistema SHALL exponer `POST /reservations/:id/cancel`, restringido al rol `USER` y al dueño de la reserva. Si la reserva está `ACTIVE` y su `expiresAt` no ha pasado según la hora de la base de datos, el sistema MUST pasarla a `CANCELLED_BY_USER` y su seat de `RESERVED` a `AVAILABLE` en una sola transacción, y responder `200` con la reserva en el mismo formato que `POST /reservations`.

#### Scenario: Cancelación de una reserva vigente
- **WHEN** el dueño cancela una reserva `ACTIVE` que no ha vencido
- **THEN** el sistema responde `200` con `status` `CANCELLED_BY_USER`, y el seat queda `AVAILABLE`

#### Scenario: El seat se puede volver a reservar
- **WHEN** el dueño cancela su reserva y otro usuario reserva el mismo seat
- **THEN** la nueva reserva se crea con `201`

### Requirement: Reserva no cancelable
Si la reserva no se puede cancelar, el sistema MUST responder `409` con un `code` según su estado, y MUST NOT modificar la reserva ni el seat:
- `CANCELLED_BY_USER` → `RESERVATION_ALREADY_CANCELLED`;
- `CONFIRMED` → `RESERVATION_ALREADY_CONFIRMED`;
- `CANCELLED`, o su evento está `CANCELLED` → `EVENT_CANCELLED`;
- `EXPIRED`, o `ACTIVE` con `expiresAt` vencido aunque el job no la haya liberado → `RESERVATION_EXPIRED`.

#### Scenario: Cancelar dos veces
- **WHEN** el dueño cancela una reserva que ya canceló
- **THEN** el sistema responde `409` con `code` `RESERVATION_ALREADY_CANCELLED`

#### Scenario: Reserva pagada
- **WHEN** el dueño cancela una reserva `CONFIRMED`
- **THEN** el sistema responde `409` con `code` `RESERVATION_ALREADY_CONFIRMED` y el seat sigue `SOLD`

#### Scenario: Evento cancelado
- **WHEN** el dueño cancela una reserva cuyo evento fue cancelado
- **THEN** el sistema responde `409` con `code` `EVENT_CANCELLED` y el seat sigue `BLOCKED`

#### Scenario: Vencida antes de que corra el job
- **WHEN** el dueño cancela una reserva `ACTIVE` cuyo `expiresAt` ya pasó
- **THEN** el sistema responde `409` con `code` `RESERVATION_EXPIRED`, y la reserva sigue `ACTIVE` y el seat `RESERVED` hasta que la liberación la procese

### Requirement: Acceso a la cancelación de reservas
El sistema MUST responder `401` con `code` `UNAUTHORIZED` sin token válido y `403` con `code` `FORBIDDEN` si el usuario no tiene rol `USER` o la reserva pertenece a otro usuario, sin modificar nada. Si la reserva no existe, MUST responder `404` con `code` `RESERVATION_NOT_FOUND`; si `id` no es un UUID, `400` con `code` `VALIDATION_ERROR`.

#### Scenario: Reserva de otro usuario
- **WHEN** un `USER` cancela una reserva de otro usuario
- **THEN** el sistema responde `403` con `code` `FORBIDDEN`, y la reserva sigue `ACTIVE` y el seat `RESERVED`

#### Scenario: ADMIN
- **WHEN** un `ADMIN` llama a `POST /reservations/:id/cancel`
- **THEN** el sistema responde `403` con `code` `FORBIDDEN`

#### Scenario: Sin token
- **WHEN** se llama sin `Authorization`
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

#### Scenario: Reserva inexistente
- **WHEN** un `USER` cancela un UUID que no corresponde a ninguna reserva
- **THEN** el sistema responde `404` con `code` `RESERVATION_NOT_FOUND`

#### Scenario: Id inválido
- **WHEN** `id` no es un UUID
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

### Requirement: Cancelación de reserva concurrente
La cancelación por el dueño MUST ser consistente cuando ocurre a la vez que la cancelación del evento, una compra o la liberación de vencidas, sin interbloqueos y sin dejar una reserva y su seat en estados contradictorios.

#### Scenario: A la vez que la cancelación del evento
- **WHEN** el dueño cancela su reserva y el ADMIN cancela el evento al mismo tiempo
- **THEN** ninguna de las dos responde `500`; o la reserva queda `CANCELLED_BY_USER` y luego el seat `BLOCKED`, o la reserva queda `CANCELLED`, el seat `BLOCKED` y el dueño recibe `409` con `code` `EVENT_CANCELLED`

#### Scenario: Dos cancelaciones simultáneas
- **WHEN** el dueño envía dos cancelaciones de la misma reserva a la vez
- **THEN** una responde `200` y la otra `409` con `code` `RESERVATION_ALREADY_CANCELLED`
