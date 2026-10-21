## Purpose

Define cómo se generan los seats de un evento según su capacidad y cómo se consultan por estado, en particular los disponibles.

## ADDED Requirements

### Requirement: Generación de seats
Al crear un evento, el sistema SHALL generar exactamente `capacity` seats con estado `AVAILABLE`, en filas de 10 puestos con letras consecutivas desde `A` y números desde 1. La última fila MAY quedar incompleta. La generación MUST ocurrir de forma atómica con la creación del evento.

#### Scenario: Capacidad múltiplo de 10
- **WHEN** se crea un evento con `capacity` 20
- **THEN** existen 20 seats: `A1` a `A10` y `B1` a `B10`, todos `AVAILABLE`

#### Scenario: Última fila incompleta
- **WHEN** se crea un evento con `capacity` 25
- **THEN** existen 25 seats: `A1` a `A10`, `B1` a `B10` y `C1` a `C5`

#### Scenario: Capacidad máxima
- **WHEN** se crea un evento con `capacity` 260
- **THEN** existen seats desde `A1` hasta `Z10`

#### Scenario: Fallo al crear el evento
- **WHEN** la creación del evento falla
- **THEN** no queda ningún seat huérfano

### Requirement: Unicidad de seats
El sistema MUST garantizar a nivel de datos que no existan dos seats con la misma fila y número dentro de un evento.

#### Scenario: Seat duplicado
- **WHEN** se intenta guardar un segundo seat `A1` para el mismo evento
- **THEN** la operación es rechazada por la base de datos

### Requirement: Listado de seats de un evento
El sistema SHALL exponer `GET /events/:id/seats`, que requiere autenticación y responde `200` con `{ eventId, data: [seat] }`, donde cada seat incluye `id`, `row`, `number`, `label` (fila y número, por ejemplo `A1`) y `status`. SHALL aceptar el filtro opcional `status` con los valores `AVAILABLE`, `RESERVED`, `SOLD` o `BLOCKED`, y devolver los seats ordenados por fila y número.

#### Scenario: Seats disponibles de un evento nuevo
- **WHEN** un usuario autenticado consulta `GET /events/:id/seats?status=AVAILABLE` de un evento con `capacity` 20
- **THEN** el sistema responde `200` con 20 seats ordenados de `A1` a `B10`

#### Scenario: Listado sin filtro
- **WHEN** se consulta sin `status`
- **THEN** el sistema devuelve los seats del evento en todos los estados

#### Scenario: Filtro inválido
- **WHEN** `status` es `FREE`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

### Requirement: Evento inexistente o acceso sin autenticar
El sistema MUST responder `404` con `code` `EVENT_NOT_FOUND` si el evento no existe y `401` con `code` `UNAUTHORIZED` si no hay token válido.

#### Scenario: Evento inexistente
- **WHEN** se consulta `GET /events/:id/seats` con un id que no existe
- **THEN** el sistema responde `404` con `code` `EVENT_NOT_FOUND`

#### Scenario: Sin token
- **WHEN** se consulta sin `Authorization`
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

### Requirement: Disponibilidad solo en eventos activos
El filtro `status=AVAILABLE` SHALL devolver únicamente seats de eventos `ACTIVE`; un evento cancelado, cuyos seats están `BLOCKED`, devuelve una lista vacía.

#### Scenario: Evento cancelado
- **WHEN** se consulta `status=AVAILABLE` de un evento `CANCELLED`
- **THEN** el sistema responde `200` con `data` vacío
