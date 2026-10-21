## Purpose

Permite a un usuario consultar los tickets que ha comprado, incluidos los de eventos cancelados con su estado.

## ADDED Requirements

### Requirement: Mis tickets
El sistema SHALL exponer `GET /tickets/me`, restringido al rol `USER`, que responde `200` con `{ data: [ticket], meta }`, donde cada ticket incluye `id`, `status`, `seat`, `amount`, `issuedAt` y `event` con `id`, `name`, `venue` y `startDate`. SHALL devolver únicamente los tickets del usuario autenticado, ordenados del más reciente al más antiguo (con `id` como desempate).

#### Scenario: Tickets propios
- **WHEN** un USER con dos tickets consulta `GET /tickets/me`
- **THEN** el sistema responde `200` con sus dos tickets, el más reciente primero, y `meta.total` 2

#### Scenario: Tickets de otros usuarios
- **WHEN** existen tickets de otro USER
- **THEN** no aparecen en la respuesta

#### Scenario: Sin tickets
- **WHEN** el usuario no tiene tickets
- **THEN** el sistema responde `200` con `data` vacío y `total` 0

### Requirement: Tickets de eventos cancelados
Un ticket de un evento cancelado SHALL aparecer con `status` `CANCELLED_BY_EVENT`.

#### Scenario: Evento cancelado
- **WHEN** el evento de un ticket fue cancelado
- **THEN** el ticket figura con `status` `CANCELLED_BY_EVENT`

### Requirement: Paginación
El listado SHALL paginarse con `page` y `pageSize` (de 1 a 20, por defecto 20) y `meta { page, pageSize, total, totalPages }`; un `pageSize` fuera de rango o un `page` inválido MUST responder `400` con `code` `VALIDATION_ERROR` sin recortar el valor.

#### Scenario: Segunda página
- **WHEN** el usuario tiene 25 tickets y consulta `page` 2 con `pageSize` 20
- **THEN** la respuesta trae 5 tickets y `meta` con `totalPages` 2

#### Scenario: Tamaño de página excesivo
- **WHEN** `pageSize` es 21
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

### Requirement: Acceso restringido
El sistema MUST responder `401` con `code` `UNAUTHORIZED` sin token válido y `403` con `code` `FORBIDDEN` si el usuario no es `USER`.

#### Scenario: Sin token
- **WHEN** se llama sin `Authorization`
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

#### Scenario: ADMIN
- **WHEN** un ADMIN llama a `GET /tickets/me`
- **THEN** el sistema responde `403` con `code` `FORBIDDEN`
