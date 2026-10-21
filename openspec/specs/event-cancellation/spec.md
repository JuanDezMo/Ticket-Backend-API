# event-cancellation Specification

## Purpose

Permite a un administrador cancelar un evento sin eliminarlo, dejando consistentes sus seats y reservas, de forma atómica y segura ante solicitudes concurrentes.

## Requirements

### Requirement: Cancelar un evento
El sistema SHALL exponer `POST /events/:id/cancel`, restringido al rol `ADMIN`, que cancela el evento y responde `200` con `{ id, status, cancelledReservations, cancelledTickets }`, donde `status` es `CANCELLED`. El evento MUST NOT eliminarse.

#### Scenario: Cancelación exitosa
- **WHEN** un ADMIN cancela un evento `ACTIVE`
- **THEN** el sistema responde `200` con `status` `CANCELLED` y el evento sigue existiendo

#### Scenario: El evento sigue visible
- **WHEN** un evento fue cancelado
- **THEN** `GET /events` lo lista con `status` `CANCELLED`

### Requirement: Acceso restringido
El sistema MUST responder `401` con `code` `UNAUTHORIZED` si no hay token válido y `403` con `code` `FORBIDDEN` si el usuario no es `ADMIN`, sin modificar nada.

#### Scenario: USER intenta cancelar
- **WHEN** un usuario con rol `USER` llama a `POST /events/:id/cancel`
- **THEN** el sistema responde `403` con `code` `FORBIDDEN` y el evento sigue `ACTIVE`

#### Scenario: Sin token
- **WHEN** se llama sin `Authorization`
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

### Requirement: Evento inexistente o id inválido
El sistema MUST responder `404` con `code` `EVENT_NOT_FOUND` si el evento no existe y `400` con `code` `VALIDATION_ERROR` si el id no es un UUID.

#### Scenario: Evento desconocido
- **WHEN** el id es un UUID que no corresponde a ningún evento
- **THEN** el sistema responde `404` con `code` `EVENT_NOT_FOUND`

#### Scenario: Id con formato inválido
- **WHEN** el id es `abc`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

### Requirement: Eventos que no se pueden cancelar
El sistema MUST responder `409` con `code` `EVENT_ALREADY_CANCELLED` si el evento ya está cancelado y `409` con `code` `EVENT_ALREADY_ENDED` si su `endDate` ya pasó, sin modificar nada. Un evento ya iniciado pero que aún no terminó SHALL poder cancelarse.

#### Scenario: Evento ya cancelado
- **WHEN** se cancela un evento que ya está `CANCELLED`
- **THEN** el sistema responde `409` con `code` `EVENT_ALREADY_CANCELLED`

#### Scenario: Evento terminado
- **WHEN** el `endDate` del evento es anterior al momento actual
- **THEN** el sistema responde `409` con `code` `EVENT_ALREADY_ENDED` y el evento sigue `ACTIVE`

#### Scenario: Evento en curso
- **WHEN** el `startDate` ya pasó pero el `endDate` aún no
- **THEN** el sistema cancela el evento y responde `200`

### Requirement: Efecto sobre los seats
Al cancelar, el sistema SHALL pasar a `BLOCKED` todos los seats del evento que estén `AVAILABLE`, `RESERVED` o `SOLD`, y MUST NOT modificar seats de otros eventos.

#### Scenario: Seats en todos los estados
- **WHEN** se cancela un evento con seats `AVAILABLE`, `RESERVED` y `SOLD`
- **THEN** todos sus seats quedan `BLOCKED`

#### Scenario: Otro evento intacto
- **WHEN** se cancela un evento
- **THEN** los seats de los demás eventos conservan su estado

#### Scenario: Sin disponibilidad
- **WHEN** se consulta `GET /events/:id/seats?status=AVAILABLE` de un evento cancelado
- **THEN** el sistema responde `200` con `data` vacío

### Requirement: Efecto sobre las reservas
Al cancelar, el sistema SHALL pasar a `CANCELLED` las reservas `ACTIVE` del evento que no hayan vencido y devolver su cantidad en `cancelledReservations`. Las reservas ya vencidas MUST tratarse como `EXPIRED` y no contarse. El sistema MUST NOT modificar reservas `CONFIRMED`, `EXPIRED` ni de otros eventos.

#### Scenario: Reservas activas
- **WHEN** se cancela un evento con 3 reservas `ACTIVE` vigentes
- **THEN** las 3 quedan `CANCELLED` y `cancelledReservations` es 3

#### Scenario: Reserva vencida no contada
- **WHEN** el evento tiene una reserva `ACTIVE` ya vencida y otra vigente
- **THEN** la vencida queda `EXPIRED`, la vigente `CANCELLED` y `cancelledReservations` es 1

#### Scenario: Reservas confirmadas intactas
- **WHEN** el evento tiene una reserva `CONFIRMED`
- **THEN** su estado no cambia

### Requirement: Tickets del evento
Al cancelar, el sistema SHALL pasar a `CANCELLED_BY_EVENT` los tickets `ISSUED` del evento y marcar sus pagos como `REFUND_PENDING`, y la respuesta SHALL incluir `cancelledTickets` con la cantidad de tickets cancelados. Los tickets no se eliminan. MUST NOT modificarse tickets de otros eventos. Mientras no existan tickets emitidos en el evento, `cancelledTickets` MUST ser 0.

#### Scenario: Evento sin tickets
- **WHEN** se cancela un evento sin tickets emitidos
- **THEN** `cancelledTickets` es 0

#### Scenario: Evento con tickets vendidos
- **WHEN** se cancela un evento con 3 tickets `ISSUED`
- **THEN** los 3 quedan `CANCELLED_BY_EVENT`, sus pagos quedan `REFUND_PENDING` y `cancelledTickets` es 3

#### Scenario: Otro evento intacto
- **WHEN** se cancela un evento
- **THEN** los tickets y pagos de los demás eventos no cambian

#### Scenario: Tickets conservados
- **WHEN** un evento fue cancelado
- **THEN** sus tickets siguen existiendo y aparecen en `GET /tickets/me` con `status` `CANCELLED_BY_EVENT`

### Requirement: Operaciones posteriores bloqueadas
Una vez cancelado el evento, el sistema MUST rechazar nuevas reservas sobre él con `409` y `code` `EVENT_NOT_ACTIVE`.

#### Scenario: Reservar en un evento cancelado
- **WHEN** un USER intenta reservar un seat de un evento cancelado
- **THEN** el sistema responde `409` con `code` `EVENT_NOT_ACTIVE`

### Requirement: Atomicidad
La cancelación MUST aplicar todos sus efectos (evento, seats y reservas) en una sola transacción: si alguno falla, nada cambia.

#### Scenario: Fallo a mitad de la cancelación
- **WHEN** falla la actualización de las reservas después de bloquear los seats
- **THEN** el evento sigue `ACTIVE`, los seats conservan su estado y las reservas siguen `ACTIVE`

### Requirement: Concurrencia
Ante cancelaciones simultáneas del mismo evento, el sistema MUST permitir solo una (`200`) y responder `409` `EVENT_ALREADY_CANCELLED` a las demás. Una reserva creada a la vez que la cancelación MUST NOT quedar `ACTIVE` sobre un evento cancelado.

#### Scenario: Dos cancelaciones simultáneas
- **WHEN** dos ADMIN cancelan a la vez el mismo evento
- **THEN** una responde `200` y la otra `409` con `code` `EVENT_ALREADY_CANCELLED`

#### Scenario: Reserva simultánea a la cancelación
- **WHEN** un USER reserva un seat mientras un ADMIN cancela el evento
- **THEN** al terminar ambas operaciones el evento está `CANCELLED` y no existe ninguna reserva `ACTIVE` del evento
