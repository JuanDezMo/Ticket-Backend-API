## Why

Hoy un usuario puede reservar tantos seats de un evento como quiera: no existe ningún límite (`docs/business-rules.md` no lo define y `ReservationService.create` no cuenta). Antes de aplicarlo hay que poder definir el límite **por evento**, y el ADMIN debe fijarlo al crear el evento, porque un concierto masivo y una reunión pequeña no necesitan el mismo tope.

## What Changes

- **Nuevo campo `maxSeatsPerUser`** en el evento: entero de 1 a 8, **obligatorio al crear** (`POST /events`), **sin valor por defecto** (el ADMIN decide) e **inmutable** después, igual que `capacity` (RN-EVT-2). No puede ser mayor que `capacity`.
- Se devuelve en `POST /events`, `GET /events` y `GET /events/:id`.
- **La base de datos se recrea** (`docker compose down -v`): no hay eventos heredados, así que se edita la migración `002-create-events` y la columna queda `NOT NULL` con `CHECK (max_seats_per_user BETWEEN 1 AND 8)` y `CHECK (max_seats_per_user <= capacity)`. No hay migración de datos.
- Un `400 VALIDATION_ERROR` claro cuando falta ("maxSeatsPerUser: is required", con el formato de mensaje que ya usa el validador) o está fuera de rango.
- Reglas nuevas en `docs/business-rules.md` (RN-EVT-8) y contrato en `docs/architecture.md` (§11).
- **Esta iteración no aplica el límite**: solo lo guarda y lo expone. Aplicarlo es `seat-limit-enforcement`.

## Fuera de alcance

- Aplicar el límite al reservar (`seat-limit-enforcement`).
- Editar el límite de un evento ya creado, ni un endpoint para hacerlo.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `event-management`: crear y devolver `maxSeatsPerUser`, con su validación (1 a 8 y no mayor que `capacity`).

## Impact

- **Código:** `src/db/migrations/002-create-events.ts` (editada), `src/db/types.ts`, `src/modules/events/*` (esquemas, tipos, repositorio, servicio).
- **API:** campo obligatorio nuevo en `POST /events` (**BREAKING**: sin él responde `400`). Mitigación: el único creador de eventos es el panel de admin, que se actualiza en el mismo despliegue; se actualizan en el mismo cambio `tests/helpers/events.ts`, las pruebas de integración que crean eventos, `scripts/verify-gateway.sh` y la documentación.
- **Operación:** hay que recrear el volumen de PostgreSQL en cada entorno (local y CI).
- **Esfuerzo estimado:** 1 día con pruebas.
- **Depende de:** nada. Va primero.
