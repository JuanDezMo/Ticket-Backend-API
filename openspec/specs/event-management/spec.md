# event-management Specification

## Purpose

Permite a un administrador crear eventos con capacidad paramétrica y a cualquier persona consultar el listado de eventos, incluidos los cancelados con su estado.

## Requirements

### Requirement: Creación de eventos
El sistema SHALL exponer `POST /events`, restringido al rol `ADMIN`, que recibe `name`, `description`, `type`, `venue`, `price`, `capacity`, `maxSeatsPerUser`, `startDate` y `endDate`, y responde `201` con el evento `{ id, name, description, type, venue, price, capacity, maxSeatsPerUser, startDate, endDate, createdAt, status }`. El sistema SHALL asignar `createdAt` y `status` `ACTIVE`.

#### Scenario: Evento creado por un ADMIN
- **WHEN** un `ADMIN` envía todos los campos válidos
- **THEN** el sistema responde `201` con `status` `ACTIVE`, el `maxSeatsPerUser` enviado y un `createdAt` asignado por el sistema

#### Scenario: Capacidad paramétrica
- **WHEN** un `ADMIN` crea un evento con `capacity` 20 y otro con `capacity` 100
- **THEN** ambos se crean con la capacidad indicada

### Requirement: Acceso a la creación
El sistema MUST responder `401` con `code` `UNAUTHORIZED` si no hay token válido y `403` con `code` `FORBIDDEN` si el usuario no es `ADMIN`, sin crear el evento.

#### Scenario: USER intenta crear un evento
- **WHEN** un usuario con rol `USER` llama a `POST /events`
- **THEN** el sistema responde `403` con `code` `FORBIDDEN` y no crea el evento

#### Scenario: Sin token
- **WHEN** se llama a `POST /events` sin `Authorization`
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

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

### Requirement: Validación de fechas
Las fechas SHALL ser ISO 8601; `startDate` MUST ser posterior al momento actual y `endDate` MUST ser posterior a `startDate`. En caso contrario el sistema responde `400` con `code` `VALIDATION_ERROR`.

#### Scenario: Fecha de inicio en el pasado
- **WHEN** `startDate` es anterior al momento actual
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Fin anterior al inicio
- **WHEN** `endDate` es anterior o igual a `startDate`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

### Requirement: Capacidad inmutable
El sistema SHALL tratar la capacidad como fija desde la creación del evento y MUST NOT exponer ninguna operación para modificarla.

#### Scenario: Sin operación de edición
- **WHEN** se intenta modificar un evento existente mediante la API
- **THEN** la API no ofrece esa operación y responde `404` `NOT_FOUND`

### Requirement: Listado público de eventos
El sistema SHALL exponer `GET /events` sin autenticación, que responde `200` con `{ data: [evento], meta: { page, pageSize, total, totalPages } }` e incluye los eventos `ACTIVE` y `CANCELLED` con su `status`, ordenados por `startDate` ascendente y por `id` como desempate.

#### Scenario: Listado sin token
- **WHEN** se llama a `GET /events` sin `Authorization`
- **THEN** el sistema responde `200` con los eventos dentro de `data` y el `meta` de paginación

#### Scenario: Evento cancelado visible
- **WHEN** existe un evento `CANCELLED`
- **THEN** aparece en el listado con `status` `CANCELLED`

#### Scenario: Sin eventos
- **WHEN** no existe ningún evento
- **THEN** el sistema responde `200` con `data` vacío, `total` 0 y `totalPages` 0

### Requirement: Paginación del listado
El sistema SHALL paginar `GET /events` con los parámetros `page` (entero mayor o igual a 1, por defecto 1) y `pageSize` (entero entre 1 y 20, por defecto 20). El sistema MUST responder `400` con `code` `VALIDATION_ERROR` si `pageSize` es menor a 1 o mayor a 20, o si `page` es menor a 1 o no es un entero, y MUST NOT ajustar el valor en silencio.

#### Scenario: Primera página
- **WHEN** existen 45 eventos y se consulta con `pageSize` 20
- **THEN** la respuesta trae 20 eventos y `meta` con `page` 1, `pageSize` 20, `total` 45 y `totalPages` 3

#### Scenario: Última página incompleta
- **WHEN** se consulta `page` 3 con `pageSize` 20 y existen 45 eventos
- **THEN** la respuesta trae 5 eventos

#### Scenario: Página fuera de rango
- **WHEN** se consulta `page` 10 y solo existen 3 páginas
- **THEN** el sistema responde `200` con `data` vacío y el `meta` correcto

#### Scenario: Tamaño de página por encima del máximo
- **WHEN** se consulta con `pageSize` 21
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Tamaño de página inválido
- **WHEN** `pageSize` es 0, negativo o no numérico
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Orden estable entre páginas
- **WHEN** se recorren todas las páginas sin cambios en los datos
- **THEN** ningún evento aparece repetido ni se omite

### Requirement: Filtros del listado
El sistema SHALL aceptar en `GET /events` los filtros opcionales `status` (`ACTIVE` o `CANCELLED`), `type` (`CONCERT`, `MEETUP`, `MEETING` u `OTHER`), `startFrom` y `startTo` (fechas ISO 8601 que acotan `startDate`) y `search` (texto contenido en el nombre, sin distinguir mayúsculas). Los filtros SHALL combinarse con AND y `meta.total` MUST reflejar solo los eventos filtrados. Un valor inválido o `startFrom` posterior a `startTo` MUST responder `400` con `code` `VALIDATION_ERROR`.

#### Scenario: Filtro por tipo
- **WHEN** se consulta con `type` `CONCERT`
- **THEN** la respuesta contiene solo conciertos y `meta.total` cuenta solo conciertos

#### Scenario: Filtro por estado
- **WHEN** se consulta con `status` `CANCELLED`
- **THEN** la respuesta contiene solo eventos cancelados

#### Scenario: Filtros combinados
- **WHEN** se consulta con `type` `MEETUP` y un rango `startFrom` y `startTo`
- **THEN** la respuesta contiene solo meetups cuyo `startDate` está dentro del rango

#### Scenario: Búsqueda por nombre
- **WHEN** se consulta con `search` `rock`
- **THEN** la respuesta incluye el evento "Rock Night" aunque la búsqueda esté en otras mayúsculas

#### Scenario: Rango de fechas invertido
- **WHEN** `startFrom` es posterior a `startTo`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Valor de filtro inválido
- **WHEN** `type` es `FESTIVAL`
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
