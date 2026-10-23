## ADDED Requirements

### Requirement: Límite de seats por usuario
Todo evento SHALL tener un `maxSeatsPerUser`: el máximo de seats que un mismo usuario puede tener reservados o comprados en ese evento. El ADMIN SHALL definirlo al crear el evento, es obligatorio y no tiene valor por defecto. MUST ser un entero entre 1 y 8 y no mayor que la `capacity` del evento. Es fijo desde la creación, igual que la capacidad, y el sistema MUST NOT exponer ninguna operación para modificarlo.

#### Scenario: Límite definido al crear
- **WHEN** un `ADMIN` crea un evento de `capacity` 20 con `maxSeatsPerUser` 4
- **THEN** el evento se crea con `maxSeatsPerUser` 4

#### Scenario: Límite mínimo
- **WHEN** un `ADMIN` crea un evento con `maxSeatsPerUser` 1
- **THEN** el evento se crea con `maxSeatsPerUser` 1

#### Scenario: Límite máximo
- **WHEN** un `ADMIN` crea un evento de `capacity` 20 con `maxSeatsPerUser` 8
- **THEN** el evento se crea con `maxSeatsPerUser` 8

#### Scenario: Límite distinto por evento
- **WHEN** un `ADMIN` crea un evento con `maxSeatsPerUser` 2 y otro con 8
- **THEN** cada evento conserva su propio valor

#### Scenario: Límite ausente
- **WHEN** el cuerpo de `POST /events` no incluye `maxSeatsPerUser`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`, un mensaje que indica que `maxSeatsPerUser` es obligatorio y no crea el evento

#### Scenario: Límite fuera de rango
- **WHEN** `maxSeatsPerUser` es 0, 9, un decimal o un texto
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y no crea el evento

#### Scenario: Límite mayor que la capacidad
- **WHEN** `capacity` es 4 y `maxSeatsPerUser` es 5
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y no crea el evento

#### Scenario: Límite igual a la capacidad
- **WHEN** `capacity` es 4 y `maxSeatsPerUser` es 4
- **THEN** el evento se crea

#### Scenario: Sin operación de edición
- **WHEN** se intenta modificar el límite de un evento existente mediante la API
- **THEN** la API no ofrece esa operación y responde `404` `NOT_FOUND`

## MODIFIED Requirements

### Requirement: Creación de eventos
El sistema SHALL exponer `POST /events`, restringido al rol `ADMIN`, que recibe `name`, `description`, `type`, `venue`, `price`, `capacity`, `maxSeatsPerUser`, `startDate` y `endDate`, y responde `201` con el evento `{ id, name, description, type, venue, price, capacity, maxSeatsPerUser, startDate, endDate, createdAt, status }`. El sistema SHALL asignar `createdAt` y `status` `ACTIVE`.

#### Scenario: Evento creado por un ADMIN
- **WHEN** un `ADMIN` envía todos los campos válidos
- **THEN** el sistema responde `201` con `status` `ACTIVE`, el `maxSeatsPerUser` enviado y un `createdAt` asignado por el sistema

#### Scenario: Capacidad paramétrica
- **WHEN** un `ADMIN` crea un evento con `capacity` 20 y otro con `capacity` 100
- **THEN** ambos se crean con la capacidad indicada

### Requirement: Validación de campos del evento
El sistema SHALL exigir `name`, `description` y `venue` no vacíos, `type` dentro de `CONCERT`, `MEETUP`, `MEETING` u `OTHER`, `price` mayor a 0, `capacity` entero entre 1 y 260 y `maxSeatsPerUser` entero entre 1 y 8 que no supere `capacity`; en caso contrario MUST responder `400` con `code` `VALIDATION_ERROR` y sin crear el evento.

#### Scenario: Tipo inválido
- **WHEN** `type` es `FESTIVAL`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Capacidad fuera de rango
- **WHEN** `capacity` es 0 o 261
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Precio no positivo
- **WHEN** `price` es 0 o negativo
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Límite por usuario inválido
- **WHEN** `maxSeatsPerUser` es 0, 9 o mayor que `capacity`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

### Requirement: Detalle público de un evento
El sistema SHALL exponer `GET /events/:id` sin autenticación, que responde `200` con el evento `{ id, name, description, type, venue, price, capacity, maxSeatsPerUser, startDate, endDate, createdAt, status }`, el mismo formato del listado. Un evento `CANCELLED` SHALL devolverse con su `status`. Si el evento no existe, el sistema MUST responder `404` con `code` `EVENT_NOT_FOUND`; si `id` no es un UUID, MUST responder `400` con `code` `VALIDATION_ERROR`.

#### Scenario: Evento existente sin token
- **WHEN** se llama a `GET /events/:id` sin `Authorization` con el id de un evento existente
- **THEN** el sistema responde `200` con el evento, incluido `maxSeatsPerUser`, y los mismos campos y valores que tiene en `GET /events`

#### Scenario: Evento cancelado
- **WHEN** se consulta un evento `CANCELLED`
- **THEN** el sistema responde `200` con `status` `CANCELLED`

#### Scenario: Evento inexistente
- **WHEN** se consulta un UUID que no corresponde a ningún evento
- **THEN** el sistema responde `404` con `code` `EVENT_NOT_FOUND`

#### Scenario: Id inválido
- **WHEN** `id` no es un UUID, por ejemplo `abc`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Con token también responde
- **WHEN** un usuario `USER` o `ADMIN` llama a `GET /events/:id` con su token
- **THEN** el sistema responde `200` con el mismo evento
