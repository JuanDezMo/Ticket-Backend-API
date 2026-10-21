## Context

Continúa `auth-users`, que aporta `authenticate`, `requireRole`, el manejo de errores `{ code, message }`, la validación con zod, Kysely, las migraciones y la estructura por módulos. Alcance en `proposal.md`; contrato y códigos en `docs/architecture.md` (sección 11) y reglas en `docs/business-rules.md` (secciones 3 y 4).

## Goals / Non-Goals

**Goals:**
- Crear eventos con sus seats de forma atómica.
- Consultar eventos y seats con un contrato estable que usarán `reservations`, `event-cancellation` y `ticket-purchase`.

**Non-Goals:**
- Edición o borrado de eventos, cambio de capacidad, paginación por cursor, orden configurable y cancelación.

## Decisions

**Módulos**
```
modules/events/  event.routes|controller|service|repository|schemas|types.ts
modules/seats/   seat.routes|controller|service|repository|schemas|types.ts
```
`events` orquesta la creación y usa el `SeatService` para generar seats; nunca el repository de `seats`. La ruta `GET /events/:id/seats` pertenece al módulo `seats` y consulta la existencia del evento mediante el `EventService`.

**Creación atómica.** `EventService.create` abre una transacción con `db.transaction()`, inserta el evento y pide a `SeatService` generar los seats con esa misma transacción. Los seats se insertan en un único `INSERT` múltiple (hasta 260 filas), no uno por uno. Si algo falla, no queda nada.

**Generación de seats.** Función pura `generateSeatLayout(capacity)` que devuelve `{ row, number }[]`: fila `String.fromCharCode(65 + Math.floor(i / 10))` y número `(i % 10) + 1`, para `i` de 0 a `capacity - 1`. Se prueba con tests unitarios sin base de datos. El tope de 260 (`A..Z`) está en la validación de `capacity`.

**Datos.** Migración con:
- `events`: `id` (uuid), `name`, `description`, `type`, `venue`, `price` (`NUMERIC(12,2)`), `capacity`, `start_date`, `end_date`, `status`, `created_at`. `CHECK` para `type`, `status` y `capacity BETWEEN 1 AND 260`.
- `seats`: `id` (uuid), `event_id` (FK), `row` (1 carácter), `number`, `status`, con `UNIQUE (event_id, row, number)` e índice `(event_id, status)`. `CHECK` para `status` (`AVAILABLE`, `RESERVED`, `SOLD`, `BLOCKED`).
- Fechas en `timestamptz`. Índices de `events`: `(start_date, id)` para el orden y la paginación, `(status)` y `(type)` para los filtros. Tipos regenerados con `kysely-codegen`.

**Validación (zod).** `price` número positivo con hasta 2 decimales; `capacity` entero 1 a 260; fechas ISO 8601 con `startDate > now` y `endDate > startDate`. La comparación con "ahora" usa el reloj del servidor aquí, porque aún no depende de la BD. `status` del filtro validado contra el enum de estados de seat.

**Constantes.** Enums `EventType`, `EventStatus` y `SeatStatus` en los `*.types.ts`, y constantes `SEATS_PER_ROW` (10) y `MAX_CAPACITY` (260), sin literales en `service` ni `controller`. Nuevos `ErrorCode`: `EVENT_NOT_FOUND`.

**Listado de eventos.** `GET /events` es público (la ruta no aplica `authenticate`), ordena por `start_date` ascendente con `id` como desempate y devuelve todos los estados.

**Paginación.** Por página: `page` (mínimo 1, por defecto 1) y `pageSize` (1 a 20, por defecto 20). Un `pageSize` mayor a 20 no se recorta: responde `400` `VALIDATION_ERROR`. El schema compartido `paginationSchema` y el helper `paginate` (calcula `totalPages` y arma `meta`) viven en `shared/utils` para reutilizarlos en otros listados. La respuesta es `{ data, meta: { page, pageSize, total, totalPages } }`. Alternativa descartada: paginación por cursor, por ser más compleja para un junior y no necesaria a este volumen.

**Filtros.** Schema del módulo `events` con `status`, `type`, `startFrom`, `startTo` y `search`, con coerción de strings desde el query. Validaciones: enums, fechas ISO y `startFrom <= startTo`. El repository construye el `where` dinámico en Kysely y ejecuta dos consultas con los mismos filtros: la página (`limit`/`offset`) y el `count` para `meta.total`. `search` usa `ILIKE` sobre el nombre con el texto escapado; a mayor escala se evaluaría `pg_trgm`.

**Listado de seats.** Filtra por `event_id` y, si se envía, por `status`; ordena por `row, number`. Para `AVAILABLE` no hay lógica extra: un evento cancelado tiene sus seats `BLOCKED` y devuelve vacío por consistencia de datos. El cambio `reservations` añadirá la liberación de reservas vencidas antes de esta consulta (RN-RES-6).

**Dinero.** `price` se guarda como `NUMERIC(12,2)` y se devuelve como número en el JSON.

**Pruebas.** Unitarias para `generateSeatLayout` y las reglas de fechas del servicio; unitarias también para el schema de paginación, el cálculo de `meta` y el schema de filtros; integración con supertest y Testcontainers para rutas, transacción, índices, filtros combinados y orden estable entre páginas; la regla de arquitectura de `dependency-cruiser` ya cubre los módulos nuevos.

## Risks / Trade-offs

- [Reloj del servidor para `startDate`] → suficiente para validar la entrada; la expiración de reservas sí usa el reloj de la BD, en `reservations`.
- [`pageSize` máximo de 20, rechazando valores mayores] → un cliente que pida más recibe `400`; queda explícito en el contrato y evita respuestas grandes.
- [Paginación por página con `offset`] → puede degradar con muchas páginas profundas; aceptable al volumen del MVP.
- [Dos consultas por listado (página y conteo)] → pequeña carga extra, necesaria para `meta.total`.
- [Un solo `INSERT` de hasta 260 filas] → volumen pequeño y acotado; evita 260 viajes a la BD.
- [Capacidad inmutable] → simplifica la consistencia de seats; cambiarla requeriría un cambio posterior.

## Migration Plan

Una migración nueva que se aplica al arrancar. Reversión en desarrollo: revertir la migración o eliminar el volumen de la BD.

## Open Questions

- Ninguna que bloquee.
