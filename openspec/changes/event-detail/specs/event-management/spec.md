## ADDED Requirements

### Requirement: Detalle público de un evento
El sistema SHALL exponer `GET /events/:id` sin autenticación, que responde `200` con el evento `{ id, name, description, type, venue, price, capacity, startDate, endDate, createdAt, status }`, el mismo formato del listado. Un evento `CANCELLED` SHALL devolverse con su `status`. Si el evento no existe, el sistema MUST responder `404` con `code` `EVENT_NOT_FOUND`; si `id` no es un UUID, MUST responder `400` con `code` `VALIDATION_ERROR`.

#### Scenario: Evento existente sin token
- **WHEN** se llama a `GET /events/:id` sin `Authorization` con el id de un evento existente
- **THEN** el sistema responde `200` con el evento y los mismos campos y valores que tiene en `GET /events`

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
