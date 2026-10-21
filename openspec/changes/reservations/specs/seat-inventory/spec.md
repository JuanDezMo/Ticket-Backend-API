## MODIFIED Requirements

### Requirement: Listado de seats de un evento
El sistema SHALL exponer `GET /events/:id/seats`, que requiere autenticación y responde `200` con `{ eventId, data: [seat] }`, donde cada seat incluye `id`, `row`, `number`, `label` (fila y número, por ejemplo `A1`) y `status`. SHALL aceptar el filtro opcional `status` con los valores `AVAILABLE`, `RESERVED`, `SOLD` o `BLOCKED`, y devolver los seats ordenados por fila y número. Antes de consultar, el sistema SHALL liberar las reservas vencidas del evento, de modo que ningún seat aparezca ocupado por una reserva ya vencida.

#### Scenario: Seats disponibles de un evento nuevo
- **WHEN** un usuario autenticado consulta `GET /events/:id/seats?status=AVAILABLE` de un evento con `capacity` 20
- **THEN** el sistema responde `200` con 20 seats ordenados de `A1` a `B10`

#### Scenario: Listado sin filtro
- **WHEN** se consulta sin `status`
- **THEN** el sistema devuelve los seats del evento en todos los estados

#### Scenario: Filtro inválido
- **WHEN** `status` es `FREE`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Reserva vencida liberada al listar
- **WHEN** un seat tiene una reserva `ACTIVE` ya vencida y se consulta `status=AVAILABLE`
- **THEN** el seat aparece como `AVAILABLE` y su reserva queda `EXPIRED`

#### Scenario: Reserva vigente
- **WHEN** un seat tiene una reserva `ACTIVE` que aún no vence
- **THEN** el seat aparece como `RESERVED` y no figura entre los `AVAILABLE`
