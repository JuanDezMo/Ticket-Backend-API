## Context

`EventService.getById(id)` ya existe y lanza `AppError('EVENT_NOT_FOUND')`; hoy lo usan las reservas y la cancelación. `toPublicEvent(event)` ya convierte el modelo al formato público. Las rutas `/events/:id/seats` y `/events/:id/cancel` se montan aparte en `src/app.ts`.

## Goals / Non-Goals

**Goals:**
- Exponer el detalle sin lógica nueva, reutilizando el service y el mapper existentes.

**Non-Goals:**
- Cambiar `EventService.getById` ni el repository.

## Decisions

### 1. La ruta va en el router de eventos
`router.get('/:id', validate(eventIdParamsSchema, 'params'), controller.getById)` en `event.routes.ts`, sin `authenticate`, igual que el listado.
- Express compara la ruta completa, así que `GET /events/:id` no captura `/events/:id/seats` ni `/events/:id/cancel`; no hace falta cambiar el orden en `app.ts`.
- *Alternativa:* un router nuevo. Se descarta porque es el mismo recurso.

### 2. Schema de params propio del módulo
Se agrega `eventIdParamsSchema = z.object({ id: z.uuid() })` en `event.schemas.ts`. Ya existe uno igual en `seats/seat.schemas.ts`, pero importar el schema de otro módulo acopla los módulos por un detalle de HTTP. Se acepta la duplicación de una línea.
- *Alternativa:* moverlo a `src/shared/`. Es válido, pero tocaría el módulo de seats y amplía el cambio; queda como mejora opcional.

### 3. El controller convierte con `toPublicEvent`
`getById` lee `res.locals.params.id` (los params validados quedan en `res.locals`), llama a `eventService.getById(id)` y responde `200` con `toPublicEvent(event)`, igual que `create`.

## Risks / Trade-offs

- [Se podría enumerar eventos por id] → los ids son UUID y el listado ya es público, así que no se expone nada nuevo.
