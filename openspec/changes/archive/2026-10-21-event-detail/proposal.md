## Why

La UI (`ticket_frontend`) necesita abrir el detalle de un evento por su enlace o al recargar la página, y hoy solo existe el listado `GET /events`. Sin un endpoint por id, la UI tendría que buscar el evento página por página. Es el hueco 2 de `docs/api-integration.md` del frontend, y debe estar listo antes de su iteración `web-events`.

## What Changes

- Nuevo endpoint público `GET /events/:id` que responde `200` con el mismo cuerpo de evento que ya usan `POST /events` y `GET /events`.
- `404 EVENT_NOT_FOUND` si el evento no existe y `400 VALIDATION_ERROR` si el `id` no es un UUID.
- Los eventos `CANCELLED` también se devuelven, con su `status`, igual que en el listado (RN-EVT-5).
- Se actualizan `docs/business-rules.md` (RN-AUTH-4 y la tabla de permisos), `docs/architecture.md` (§11.2 y §11.3) y la tabla de endpoints del `README.md`.

## Fuera de alcance

- Incluir los seats o el conteo de disponibles en la respuesta: siguen en `GET /events/:id/seats`.
- Editar o eliminar eventos: la capacidad sigue inmutable y no hay `PUT`, `PATCH` ni `DELETE` (RN-EVT-2, RN-EVT-3).
- Caché HTTP (`ETag`, `Cache-Control`).
- Cambios en la UI: se consumen en `web-events` del frontend.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `event-management`: se agrega el requisito de consultar un evento por id sin autenticación.

## Impact

- Código: `src/modules/events/` (`event.routes.ts`, `event.controller.ts`, `event.schemas.ts`). `EventService.getById` y `toPublicEvent` ya existen y se reutilizan.
- Pruebas: `tests/integration/events-routes.test.ts` y `tests/unit/event-schemas.test.ts`.
- API: un endpoint nuevo y compatible; no cambia ningún contrato existente.
- Sin migraciones de BD ni dependencias nuevas.
