# seat-reservation Specification

## Purpose

Permite a un usuario apartar un seat de un evento activo por un tiempo limitado, de forma atómica y con el precio calculado por el servidor.

## Requirements

### Requirement: Crear una reserva
El sistema SHALL exponer `POST /reservations`, restringido al rol `USER`, que recibe `eventId` y `seat` (la etiqueta del seat, por ejemplo `C7`) y responde `201` con `{ id, eventId, seatId, seat, status, amount, expiresAt, createdAt }`, donde `seat` es la etiqueta del seat (por ejemplo `C7`), `status` es `ACTIVE` y `amount` es el precio del evento. El seat SHALL pasar a `RESERVED`.

#### Scenario: Reserva exitosa
- **WHEN** un USER autenticado reserva un seat `AVAILABLE` de un evento `ACTIVE`
- **THEN** el sistema responde `201` con `status` `ACTIVE`, `amount` igual al precio del evento, y el seat queda `RESERVED`

#### Scenario: Monto tomado del servidor
- **WHEN** la solicitud incluye un campo `amount`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y no crea la reserva

### Requirement: Acceso restringido
El sistema MUST responder `401` con `code` `UNAUTHORIZED` si no hay token válido y `403` con `code` `FORBIDDEN` si el usuario autenticado no es `USER`.

#### Scenario: ADMIN intenta reservar
- **WHEN** un ADMIN llama a `POST /reservations`
- **THEN** el sistema responde `403` con `code` `FORBIDDEN` y no crea la reserva

#### Scenario: Sin token
- **WHEN** se llama sin `Authorization`
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

### Requirement: Validación de la solicitud
El sistema SHALL exigir `eventId` como UUID y `seat` como etiqueta válida, formada por una letra de `A` a `Z` seguida de un número de 1 a 10 (se acepta en minúscula y se normaliza a mayúscula). MUST responder `400` con `code` `VALIDATION_ERROR` si falta alguno, tienen formato inválido o hay campos adicionales.

#### Scenario: eventId ausente
- **WHEN** el cuerpo no incluye `eventId`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: seat ausente
- **WHEN** el cuerpo no incluye `seat`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Etiqueta con formato inválido
- **WHEN** `seat` es `7C`, `C11`, `C0` o una cadena vacía
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: eventId con formato inválido
- **WHEN** `eventId` es `abc`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Etiqueta en minúscula
- **WHEN** `seat` es `c7`
- **THEN** el sistema la trata como `C7`

### Requirement: Evento inexistente
El sistema MUST responder `404` con `code` `EVENT_NOT_FOUND` si el evento no existe.

#### Scenario: Evento desconocido
- **WHEN** `eventId` es un UUID que no corresponde a ningún evento
- **THEN** el sistema responde `404` con `code` `EVENT_NOT_FOUND`

### Requirement: Seat inexistente
El sistema MUST responder `404` con `code` `SEAT_NOT_FOUND` si el evento existe pero no tiene un seat con esa etiqueta.

#### Scenario: Etiqueta fuera de la capacidad
- **WHEN** se reserva `C7` en un evento de 20 puestos (solo existen `A1` a `B10`)
- **THEN** el sistema responde `404` con `code` `SEAT_NOT_FOUND`

#### Scenario: Seat de otro evento
- **WHEN** la etiqueta existe en otro evento pero no en el indicado
- **THEN** el sistema responde `404` con `code` `SEAT_NOT_FOUND` y no reserva el seat del otro evento

### Requirement: Seat no disponible
El sistema MUST responder `409` con `code` `SEAT_NOT_AVAILABLE` si el seat no está `AVAILABLE`, sin modificar ni la reserva existente ni el seat.

#### Scenario: Seat ya reservado
- **WHEN** otro USER reserva un seat que ya está `RESERVED` con una reserva vigente
- **THEN** el sistema responde `409` con `code` `SEAT_NOT_AVAILABLE`

#### Scenario: Seat vendido o bloqueado
- **WHEN** el seat está `SOLD` o `BLOCKED`
- **THEN** el sistema responde `409` con `code` `SEAT_NOT_AVAILABLE`

### Requirement: Evento activo y no iniciado
El sistema MUST responder `409` con `code` `EVENT_NOT_ACTIVE` si el evento del seat está `CANCELLED` o si su `startDate` ya llegó, y no crear la reserva.

#### Scenario: Evento cancelado
- **WHEN** el seat pertenece a un evento `CANCELLED`
- **THEN** el sistema responde `409` con `code` `EVENT_NOT_ACTIVE`

#### Scenario: Evento ya iniciado
- **WHEN** el `startDate` del evento es anterior al momento actual
- **THEN** el sistema responde `409` con `code` `EVENT_NOT_ACTIVE`

### Requirement: Reserva atómica
El sistema MUST garantizar que, ante solicitudes simultáneas sobre el mismo seat, solo una crea la reserva y las demás reciben `SEAT_NOT_AVAILABLE`. A nivel de datos, un seat MUST tener como máximo una reserva `ACTIVE`.

#### Scenario: Solicitudes concurrentes
- **WHEN** varios USER reservan a la vez el mismo seat `AVAILABLE`
- **THEN** exactamente una solicitud responde `201`, las demás `409`, y existe una sola reserva `ACTIVE` para el seat

#### Scenario: Fallo al crear la reserva
- **WHEN** la inserción de la reserva falla después de marcar el seat
- **THEN** el seat vuelve a `AVAILABLE` y no queda ninguna reserva

### Requirement: Estados de la reserva
Una reserva SHALL tener uno de los estados `ACTIVE`, `EXPIRED`, `CONFIRMED`, `CANCELLED` o `CANCELLED_BY_USER`, y se crea siempre `ACTIVE`. `CANCELLED` lo deja la cancelación del evento y `CANCELLED_BY_USER` la cancelación por su dueño.

#### Scenario: Estado inicial
- **WHEN** se crea una reserva
- **THEN** su estado es `ACTIVE`

#### Scenario: Consulta de una reserva cancelada por el usuario
- **WHEN** el dueño consulta con `GET /reservations/:id` una reserva que canceló
- **THEN** el sistema responde `200` con `status` `CANCELLED_BY_USER`

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

### Requirement: Reserva con seat inexistente en la consulta
Si `GET /reservations/:id` encuentra la reserva del dueño pero su seat no existe, el sistema MUST responder `500` con `code` `INTERNAL_ERROR` y el mensaje genérico, sin datos de la reserva, y SHALL registrar en el log el id del seat y el de la reserva, como cualquier error no controlado (ver `api-foundation`).

#### Scenario: Seat de la reserva inexistente
- **WHEN** el dueño consulta una reserva cuyo seat no existe
- **THEN** el sistema responde `500` con `code` `INTERNAL_ERROR` y el detalle, con el id del seat y el de la reserva, solo aparece en el log

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
