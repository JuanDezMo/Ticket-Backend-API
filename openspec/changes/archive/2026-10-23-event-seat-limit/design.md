## Context

- **Estado actual:** `events` no tiene ningún límite por usuario. La creación valida con `createEventSchema` (zod, `.strict()`) en `src/modules/events/event.schemas.ts`, el repositorio inserta en `event.repository.ts` y el servicio devuelve `PublicEvent` (`event.service.ts`). El tipo de filas de Kysely (`src/db/types.ts`) se genera con `pnpm db:codegen`.
- **Mensajes de validación:** el middleware `validate` arma el mensaje como `<campo>: <mensaje de zod>` y lo envía como `VALIDATION_ERROR`; por eso un campo faltante necesita un mensaje propio, no el de zod por defecto.
- **Base recreada:** se decidió recrear la base (`docker compose down -v`); no hay datos que migrar, así que se edita `002-create-events` en lugar de agregar una migración.
- **Esta iteración solo guarda y expone el límite.** Aplicarlo al reservar es `seat-limit-enforcement`, que lee `max_seats_per_user` del evento.
- Modelo completo y comparación con el actual: `docs/data-model.md`.

## Goals / Non-Goals

**Goals:**
- Que el límite quede validado en dos capas (API y base de datos), de modo que no se pueda guardar un evento sin él o con un valor imposible.
- Que todos los consumidores internos (pruebas, scripts, documentación) usen el nuevo contrato en el mismo cambio.

**Non-Goals:**
- Aplicar el límite (otro cambio) o permitir cambiarlo después.
- Una constante de configuración: el rango 1 a 8 es una regla de negocio fija, no un parámetro de despliegue.

## Decisions

### 1. Una constante para el máximo
`MAX_SEATS_PER_USER = 8` en `event.types.ts`, junto a `MAX_PRICE`. La usan el esquema de creación y, más adelante, la validación de las listas de `seats` y `reservationIds` de los otros cambios, para que "8" exista en un solo lugar. El valor de la base (`CHECK ... <= 8`) lo repite la migración a propósito: una restricción no puede importar una constante, y la prueba de la migración comprueba que ambas coincidan.

### 2. Columna obligatoria, sin valor por defecto
`max_seats_per_user integer NOT NULL` con dos `CHECK`: `BETWEEN 1 AND 8` y `<= capacity`. Va en la migración `002-create-events`, en el mismo `createTable`. Sin `DEFAULT`, para que cualquier inserción que lo olvide falle de inmediato en lugar de crear eventos con un límite que nadie eligió.
- *Alternativa:* migración nueva con `ALTER TABLE` y un valor por defecto. Se descarta: la base se recrea y un valor por defecto escondería el olvido.

### 3. Validación en la API
En `createEventSchema` se agrega `maxSeatsPerUser: z.number({ error: ... }).int().min(1).max(MAX_SEATS_PER_USER)`. El `error` personalizado distingue "falta" (mensaje "is required") de "valor inválido" ("must be an integer from 1 to 8"), así el mensaje final es `maxSeatsPerUser: is required`. La regla cruzada `maxSeatsPerUser <= capacity` va en el `superRefine` existente, con la ruta `maxSeatsPerUser` y el mensaje "must not exceed capacity", junto a las de fechas. Un decimal o un texto entran por la validación de tipo (`400`).

### 4. Exposición
`NewEvent`, `Event` y `PublicEvent` ganan `maxSeatsPerUser`, y el repositorio mapea `max_seats_per_user` en lectura y escritura. No hay lógica nueva en el servicio: `POST /events`, `GET /events` y `GET /events/:id` lo devuelven porque comparten `toPublicEvent`. El listado no cambia en filtros ni orden.

### 5. Tipos de Kysely
Se regeneran con `pnpm db:codegen` contra la base ya migrada, en lugar de editar `src/db/types.ts` a mano (el archivo lo declara generado). El diff debe contener solo la columna nueva.

### 6. Consumidores internos
- `tests/helpers/events.ts`: `eventBody` agrega `maxSeatsPerUser` y `insertEvent` lo inserta con `Math.min(4, capacity)` por defecto, para que las pruebas que reducen `capacity` sigan siendo válidas.
- `scripts/verify-gateway.sh`: el cuerpo de `POST /events` envía el campo.
- Documentación: `docs/business-rules.md` (campo en la tabla de la sección 3 y RN-EVT-8 con el rango y la relación con la capacidad), `docs/architecture.md` §11 (cuerpos de `POST /events` y `GET`) y el `curl` de ejemplo del `README`.

## Risks / Trade-offs

- [BREAKING: `POST /events` sin el campo responde `400`] → el único creador de eventos en producción es el panel de administración, que se actualiza en el mismo despliegue; los consumidores internos (pruebas, script y documentación) se actualizan aquí.
- [Eventos heredados sin límite] → no existen: la base se recrea. Si algún entorno conserva datos, la migración editada falla al aplicarse sobre un esquema viejo, lo cual es deseable porque obliga a recrearlo.
- [La constante y el `CHECK` se desalinean] → las pruebas usan valores límite en ambas capas: 1 y 8 se aceptan, 0 y 9 se rechazan, tanto en el esquema como al insertar directamente en la base, y así comprueban que coinciden.
- [Muchas pruebas insertan eventos] → la mayoría pasa por `insertEvent`/`eventBody`, así que el impacto se concentra en esos dos helpers.
- [Dos entornos con volúmenes viejos (local y CI)] → el paso de recrear el volumen queda en las tareas y en `docs/ci-cd.md`.
