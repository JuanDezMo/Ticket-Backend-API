## Purpose

Permite a un usuario apartar un seat de un evento activo por un tiempo limitado, de forma atómica y con el precio calculado por el servidor.

## ADDED Requirements

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
Una reserva SHALL tener uno de los estados `ACTIVE`, `EXPIRED`, `CONFIRMED` o `CANCELLED`, y se crea siempre `ACTIVE`.

#### Scenario: Estado inicial
- **WHEN** se crea una reserva
- **THEN** su estado es `ACTIVE`
