# seat-reservation Specification

## Purpose

Permite a un usuario apartar un seat de un evento activo por un tiempo limitado, de forma atómica y con el precio calculado por el servidor.

## Requirements

### Requirement: Crear una reserva
El sistema SHALL exponer `POST /reservations`, restringido al rol `USER`, que recibe `eventId` y `seats` (una lista de etiquetas de seat, por ejemplo `["C5", "C6"]`) y responde `201` con `{ reservations: [...] }`, una por seat y en el mismo orden solicitado, donde cada reserva es `{ id, eventId, seatId, seat, status, amount, expiresAt, createdAt }`, `seat` es la etiqueta, `status` es `ACTIVE` y `amount` es el precio del evento. Cada seat SHALL pasar a `RESERVED`. La creación es todo o nada: si falla cualquier seat, no se reserva ninguno. Una reserva de un solo seat es un lote de uno.

#### Scenario: Reserva exitosa
- **WHEN** un USER autenticado reserva un seat `AVAILABLE` de un evento `ACTIVE`
- **THEN** el sistema responde `201` con una reserva `ACTIVE`, `amount` igual al precio del evento, y el seat queda `RESERVED`

#### Scenario: Reserva de varios seats
- **WHEN** un USER reserva `C5`, `C6` y `C7`, todos `AVAILABLE`
- **THEN** el sistema responde `201` con tres reservas en ese orden y los tres seats quedan `RESERVED`

#### Scenario: Todo o nada
- **WHEN** un USER reserva `C5`, `C6` y `C7` y `C6` ya está `RESERVED` por otro usuario
- **THEN** el sistema responde `409` con `code` `SEAT_NOT_AVAILABLE` y `C5` y `C7` siguen `AVAILABLE`

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
El sistema SHALL exigir `eventId` como UUID y `seats` como una lista de 1 a 8 etiquetas válidas, sin repetidas, cada una formada por una letra de `A` a `Z` seguida de un número de 1 a 10 (se aceptan en minúscula y se normalizan a mayúscula). MUST responder `400` con `code` `VALIDATION_ERROR` si falta alguno, tienen formato inválido o hay campos adicionales, incluido el campo antiguo `seat`.

#### Scenario: eventId ausente
- **WHEN** el cuerpo no incluye `eventId`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: seat ausente
- **WHEN** el cuerpo no incluye `seats` (el campo que reemplaza a `seat`)
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Lista de seats vacía
- **WHEN** `seats` es una lista vacía
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Demasiados seats
- **WHEN** `seats` tiene 9 etiquetas
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Seats repetidos
- **WHEN** `seats` es `["C5", "c5"]`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Campo antiguo seat
- **WHEN** el cuerpo incluye `seat` en lugar de `seats`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Etiqueta con formato inválido
- **WHEN** alguna etiqueta es `7C`, `C11`, `C0` o una cadena vacía
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: eventId con formato inválido
- **WHEN** `eventId` es `abc`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Etiqueta en minúscula
- **WHEN** `seats` es `["c7"]`
- **THEN** el sistema la trata como `C7`

### Requirement: Evento inexistente
El sistema MUST responder `404` con `code` `EVENT_NOT_FOUND` si el evento no existe.

#### Scenario: Evento desconocido
- **WHEN** `eventId` es un UUID que no corresponde a ningún evento
- **THEN** el sistema responde `404` con `code` `EVENT_NOT_FOUND`

### Requirement: Seat inexistente
El sistema MUST responder `404` con `code` `SEAT_NOT_FOUND` si el evento existe pero no tiene un seat con alguna de las etiquetas solicitadas, y no reservar ninguno.

#### Scenario: Etiqueta fuera de la capacidad
- **WHEN** se reserva `C7` en un evento de 20 puestos (solo existen `A1` a `B10`)
- **THEN** el sistema responde `404` con `code` `SEAT_NOT_FOUND`

#### Scenario: Una etiqueta inexistente en un lote
- **WHEN** se reservan `A1` y `C7` en un evento de 20 puestos
- **THEN** el sistema responde `404` con `code` `SEAT_NOT_FOUND` y `A1` sigue `AVAILABLE`

#### Scenario: Seat de otro evento
- **WHEN** la etiqueta existe en otro evento pero no en el indicado
- **THEN** el sistema responde `404` con `code` `SEAT_NOT_FOUND` y no reserva el seat del otro evento

### Requirement: Seat no disponible
El sistema MUST responder `409` con `code` `SEAT_NOT_AVAILABLE` si alguno de los seats no está `AVAILABLE`, con un mensaje que indique las etiquetas afectadas, sin modificar ni las reservas existentes ni ninguno de los seats solicitados.

#### Scenario: Seat ya reservado
- **WHEN** otro USER reserva un seat que ya está `RESERVED` con una reserva vigente
- **THEN** el sistema responde `409` con `code` `SEAT_NOT_AVAILABLE` y el mensaje nombra el seat

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
El sistema MUST garantizar que, ante solicitudes simultáneas sobre el mismo seat, solo una crea la reserva y las demás reciben `SEAT_NOT_AVAILABLE`, y que un lote se crea completo o no se crea. A nivel de datos, un seat MUST tener como máximo una reserva `ACTIVE`. Los seats de un lote SHALL bloquearse en un orden fijo para evitar interbloqueos entre lotes simultáneos que comparten seats.

#### Scenario: Solicitudes concurrentes
- **WHEN** varios USER reservan a la vez el mismo seat `AVAILABLE`
- **THEN** exactamente una solicitud responde `201`, las demás `409`, y existe una sola reserva `ACTIVE` para el seat

#### Scenario: Lotes que se cruzan
- **WHEN** un USER reserva `C5` y `C6` y otro reserva `C6` y `C5` a la vez
- **THEN** una solicitud responde `201` con ambos seats, la otra `409` `SEAT_NOT_AVAILABLE`, y no ocurre ningún interbloqueo

#### Scenario: Fallo al crear la reserva
- **WHEN** la inserción de alguna reserva falla después de marcar los seats
- **THEN** todos los seats del lote vuelven a `AVAILABLE` y no queda ninguna reserva

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

### Requirement: Reservas de un lote con vencimiento común
Todas las reservas creadas por una misma solicitud SHALL crearse en una sola transacción y compartir `createdAt` y `expiresAt`. Una solicitud posterior crea un lote nuevo con su propio vencimiento; el sistema MUST NOT modificar el vencimiento de reservas ya creadas.

#### Scenario: Mismo vencimiento
- **WHEN** un USER reserva `C5`, `C6` y `C7` en una sola solicitud
- **THEN** las tres reservas tienen el mismo `expiresAt`

#### Scenario: Vencimiento de lotes distintos
- **WHEN** el USER reserva `C5` y, minutos después, `C6` en otra solicitud
- **THEN** cada reserva conserva su propio `expiresAt` y la primera no se modifica

### Requirement: Límite de seats por usuario y evento
Antes de reservar, el sistema SHALL contar las reservas `ACTIVE` vigentes y las `CONFIRMED` del usuario en ese evento. Si esa cantidad más los seats solicitados supera el `maxSeatsPerUser` del evento, MUST responder `409` con `code` `SEAT_LIMIT_REACHED` y el mensaje "You can hold up to N seats for this event" (N es el límite), sin reservar ningún seat. Las reservas `EXPIRED`, `CANCELLED` y `CANCELLED_BY_USER` no cuentan, y una `ACTIVE` cuyo `expiresAt` ya pasó tampoco.

#### Scenario: Reserva dentro del límite
- **WHEN** el evento permite 4 seats por usuario y el USER tiene 1 reservada y pide 3
- **THEN** el sistema responde `201` con las 3 reservas

#### Scenario: Reserva por encima del límite
- **WHEN** el evento permite 4 seats por usuario y el USER tiene 3 reservadas y pide 2
- **THEN** el sistema responde `409` con `code` `SEAT_LIMIT_REACHED` y no reserva ninguno de los 2

#### Scenario: Cuentan los tickets ya comprados
- **WHEN** el evento permite 4 seats por usuario, el USER compró 4 y pide uno más
- **THEN** el sistema responde `409` con `code` `SEAT_LIMIT_REACHED`

#### Scenario: Lo vencido o cancelado no cuenta
- **WHEN** el USER tenía 4 reservas que vencieron o cancela las suyas
- **THEN** puede reservar de nuevo hasta el límite

#### Scenario: El límite es por evento
- **WHEN** el USER alcanzó el límite en un evento y reserva en otro evento
- **THEN** el sistema responde `201`, siempre que no supere el tope global

### Requirement: Tope global de reservas activas por cuenta
El sistema SHALL limitar a `MAX_ACTIVE_HOLDS_PER_USER` (8 por defecto) las reservas `ACTIVE` vigentes que un usuario puede tener a la vez, sumando todos los eventos. Si las que ya tiene más las solicitadas lo superan, MUST responder `409` con `code` `HOLD_LIMIT_REACHED` sin reservar ningún seat. Las reservas ya compradas no cuentan para este tope.

#### Scenario: Tope alcanzado
- **WHEN** un USER tiene 8 reservas activas repartidas en varios eventos y pide un seat más
- **THEN** el sistema responde `409` con `code` `HOLD_LIMIT_REACHED`

#### Scenario: Lo comprado no cuenta
- **WHEN** un USER tiene 8 tickets comprados y ninguna reserva activa
- **THEN** puede reservar, siempre que no supere el límite del evento

#### Scenario: Valor configurable
- **WHEN** `MAX_ACTIVE_HOLDS_PER_USER` es 3 y el USER pide 4 seats a la vez
- **THEN** el sistema responde `409` con `code` `HOLD_LIMIT_REACHED`

### Requirement: Orden de las validaciones de la reserva
El sistema SHALL validar en este orden y responder el primer error: acceso, formato de la solicitud, existencia del evento, evento activo y no iniciado, existencia de todos los seats, límite del evento (`SEAT_LIMIT_REACHED`), tope global (`HOLD_LIMIT_REACHED`) y, por último, disponibilidad de los seats.

#### Scenario: Límite antes que disponibilidad
- **WHEN** el USER supera el límite del evento pidiendo un seat que además está ocupado
- **THEN** el sistema responde `409` con `code` `SEAT_LIMIT_REACHED`

### Requirement: Reservas simultáneas respetan los límites
El sistema MUST garantizar que, ante solicitudes simultáneas de un mismo usuario, la suma de sus reservas y compras nunca supere el límite del evento ni el tope global. El conteo y la creación SHALL ocurrir en la misma transacción, con un bloqueo por usuario tomado antes de contar.

#### Scenario: Dos solicitudes a la vez
- **WHEN** un USER con un límite de 2 envía a la vez dos solicitudes de un seat distinto cada una, teniendo ya 1 reservada
- **THEN** exactamente una responde `201` y la otra `409` con `code` `SEAT_LIMIT_REACHED`
