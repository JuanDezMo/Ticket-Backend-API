## 1. Implementación

- [ ] 1.1 En `src/modules/events/event.schemas.ts`, agregar `export const eventIdParamsSchema = z.object({ id: z.uuid() })` y su tipo `EventIdParams = z.infer<typeof eventIdParamsSchema>`. Verificar con `pnpm build` (tsc sin errores)
- [ ] 1.2 En `src/modules/events/event.controller.ts`, agregar el handler `getById = async (_req, res) => { const { id } = res.locals.params as EventIdParams; res.status(200).json(toPublicEvent(await this.eventService.getById(id))); }`, con la misma forma de arrow function que `list`. El controller no tiene lógica: no verifica el estado del evento ni atrapa errores, porque el `errorHandler` traduce `EVENT_NOT_FOUND` a `404`. Verificar con `pnpm build`
- [ ] 1.3 En `src/modules/events/event.routes.ts`, registrar `router.get('/:id', validate(eventIdParamsSchema, 'params'), controller.getById)` después de `router.get('/')` y sin `authenticate`. Agregar el comentario `// Público: no exige autenticación`, igual que el listado. Verificar con `pnpm arch`, que debe pasar (el controller no usa el repository)

## 2. Pruebas

- [ ] 2.1 En `tests/unit/event-schemas.test.ts`, agregar un `describe('eventIdParamsSchema')` con dos casos: acepta un UUID válido y rechaza `abc`. Verificar con `pnpm test tests/unit/event-schemas.test.ts`
- [ ] 2.2 En `tests/integration/events-routes.test.ts`, agregar `describe('GET /events/:id')` con el contexto que ya existe en el archivo (`ctx`, `adminToken`, `userToken`). Crear los datos con `insertEvent(ctx.db, ...)` de `tests/helpers/events.ts` y cubrir estos casos:
  - Sin token, responde `200` y `res.body` es igual (`toEqual`) al elemento con el mismo `id` en `GET /events`.
  - Un evento con `status: 'CANCELLED'` responde `200` con `status` `CANCELLED`.
  - `crypto.randomUUID()` responde `404` con `{ code: 'EVENT_NOT_FOUND', message: expect.any(String) }`.
  - `/events/abc` responde `400` con `code` `VALIDATION_ERROR`.
  - Con `userToken` y con `adminToken` también responde `200`.

  Verificar con `pnpm test tests/integration/events-routes.test.ts` (requiere Docker para Testcontainers)
- [ ] 2.3 No regresión de las rutas hermanas (`/events/:id/seats` y `/events/:id/cancel`): no requiere pruebas nuevas. Verificar que `pnpm test tests/integration/seats-routes.test.ts tests/integration/cancellation-routes.test.ts` pasa sin cambios

## 3. Documentación y cierre

- [ ] 3.1 En `docs/business-rules.md`:
  - RN-AUTH-4: agregar el detalle de eventos a lo público: "Registro, login, listado y detalle de eventos son públicos".
  - Tabla de permisos: agregar la fila "Ver detalle de evento" para ADMIN y USER (y público).

  Verificar leyendo la sección 2
- [ ] 3.2 En `docs/architecture.md`:
  - §11.2: agregar la fila `GET /events/:id` (público), con éxito `200` y errores `400` (id inválido) y `404 EVENT_NOT_FOUND`.
  - §11.3: indicar que `GET /events/:id` responde `200` con el mismo cuerpo que `POST /events`.

  Verificar leyendo ambas tablas
- [ ] 3.3 En `README.md`, agregar a la tabla de endpoints la fila `GET /events/:id` | Público | Detalle de un evento (incluye cancelados). Verificar con `pnpm lint` (prettier sobre markdown)
- [ ] 3.4 Correr `pnpm lint`, `pnpm build`, `pnpm arch` y `pnpm test` completos. Verificar que todo pasa y probar a mano con `docker compose up -d --build` y `curl -s localhost:3000/events/<id>`
