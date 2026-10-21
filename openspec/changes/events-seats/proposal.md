## Why

Sin eventos ni seats no hay nada que reservar ni comprar. Este cambio permite a un ADMIN publicar eventos con capacidad paramétrica y genera su mapa de seats, que es la base de las reservas, las compras y la cancelación.

## What Changes

- Creación de eventos por un `ADMIN` (`POST /events`) con tipo, fechas, venue, precio y capacidad.
- Listado público de eventos (`GET /events`), que incluye los cancelados con su estado, con paginación (`page`, `pageSize` de 1 a 20) y filtros (`status`, `type`, rango de `startDate`, `search`).
- Utilidad compartida de paginación reutilizable por otros listados.
- Generación automática de `capacity` seats al crear el evento, en filas de 10 desde la letra `A`.
- Listado de seats de un evento con filtro por estado (`GET /events/:id/seats`), para consultar los disponibles.
- Migración de la BD con las tablas `events` y `seats`.
- Módulos nuevos `events` y `seats`, reutilizando `authenticate`, `requireRole` y el manejo de errores de `auth-users`.

## Capabilities

### New Capabilities
- `event-management`: creación y listado de eventos, con validación de campos y de fechas, paginación y filtros.
- `seat-inventory`: generación de seats según la capacidad y consulta de seats por evento y estado.

### Modified Capabilities

Ninguna.

## Impact

- Código nuevo: módulos `src/modules/events` y `src/modules/seats`, y una migración.
- Rutas nuevas: `POST /events`, `GET /events` y `GET /events/:id/seats`.
- Dependencia: `auth-users` (autenticación, roles, errores, base de datos y estructura).
- Los cambios `reservations`, `event-cancellation` y `ticket-purchase` usan los eventos y seats creados aquí. `reservations` añadirá el filtro de reservas vencidas al listado de seats.
- Fuera de alcance: edición o eliminación de eventos, cambio de capacidad, `GET /events/:id`, paginación por cursor, orden configurable, paginación del listado de seats (máximo 260 filas) y cancelación de eventos (cambio `event-cancellation`).
