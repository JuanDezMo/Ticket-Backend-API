## 1. Implementación

- [x] 1.1 En `src/modules/reservations/reservation.schemas.ts`, agregar `export const reservationIdParamsSchema = z.object({ id: z.uuid() })` y el tipo `ReservationIdParams`. Verificar con `pnpm build`
- [x] 1.2 En `src/modules/reservations/reservation.service.ts`, agregar `async getForOwner(userId: string, id: string): Promise<PublicReservation>` según la decisión 3 del design:
  1. `findForPurchase(id)`; si es `null`, lanzar `new AppError('RESERVATION_NOT_FOUND')`.
  2. Si `reservation.userId !== userId`, lanzar `new AppError('FORBIDDEN')`.
  3. `this.seats.findById(reservation.seatId)`; si es `null`, lanzar `new AppError('INTERNAL_ERROR')`.
  4. Calcular `status = reservation.status === RESERVATION_STATUSES.ACTIVE && expired ? RESERVATION_STATUSES.EXPIRED : reservation.status`.
  5. Devolver `toPublicReservation({ ...reservation, status }, \`${seat.row}${seat.number}\`)`.

  No abrir transacción ni escribir en la BD. Agregar un comentario en español que explique por qué se devuelve `EXPIRED` sin escribir (RN-RES-7 y RN-RES-8). Verificar con `pnpm build`
- [x] 1.3 En `src/modules/reservations/reservation.controller.ts`, agregar el handler `getById`:

  ```ts
  getById = async (req, res) => {
    const { id } = res.locals.params as ReservationIdParams;
    res.status(200).json(await this.reservationService.getForOwner(req.auth!.userId, id));
  };
  ```

  Mantener el comentario de que la identidad sale del token. Verificar con `pnpm build`
- [x] 1.4 En `src/modules/reservations/reservation.routes.ts`, registrar `router.get('/:id', authenticate, requireRole(ROLES.USER), validate(reservationIdParamsSchema, 'params'), controller.getById)`. El orden importa: `authenticate` debe ir antes de `requireRole`, para que sin token la respuesta sea `401` y no `403`. Verificar con `pnpm arch`, que debe pasar sin violaciones

## 2. Pruebas unitarias

- [x] 2.1 En `tests/unit/reservation-schemas.test.ts`, agregar `describe('reservationIdParamsSchema')`: acepta un UUID y rechaza `abc` y `''`. Verificar con `pnpm test tests/unit/reservation-schemas.test.ts`
- [x] 2.2 En `tests/unit/reservation-service.test.ts`, extender `setup()`. El fake `seats` agrega `findById: vi.fn().mockResolvedValue(seat)`, y `setup` acepta un override para el resultado de `repo.findForPurchase` (`{ reservation, expired }` o `null`). Agregar un `describe('getForOwner')` con estos casos:
  - Dueño con reserva `ACTIVE` vigente: devuelve `status` `ACTIVE` y `seat` `C7`.
  - Dueño con reserva `ACTIVE` y `expired: true`: devuelve `EXPIRED`.
  - Reserva `CONFIRMED` con `expired: true`: devuelve `CONFIRMED`, porque solo `ACTIVE` pasa a `EXPIRED`.
  - Reserva `CANCELLED`: devuelve `CANCELLED`.
  - Otro `userId`: rechaza con `{ code: 'FORBIDDEN' }` y no llama a `seats.findById`.
  - `findForPurchase` en `null`: rechaza con `{ code: 'RESERVATION_NOT_FOUND' }`.
  - `seats.findById` en `null`: rechaza con `{ code: 'INTERNAL_ERROR' }`.
  - En todos los casos, no se llama a `repo.releaseExpired`, `repo.markConfirmed` ni `seats.markReserved`.

  Verificar con `pnpm test tests/unit/reservation-service.test.ts`

## 3. Pruebas de integración (PostgreSQL real)

- [x] 3.1 En `tests/helpers/auth.ts`, hacer que `createUserAndLogin` también devuelva `userId`: leerlo de `users` por email después de insertar, o con `returning('id')`. Hace falta para crear reservas de otro usuario con `insertReservation`. Verificar que `pnpm test` completo sigue pasando, porque el cambio es compatible y solo agrega un campo
- [x] 3.2 En `tests/integration/reservations-routes.test.ts`, agregar `describe('GET /reservations/:id')` con su propio `beforeEach` (mismo `ctx`, un evento con `insertEventWithSeats(ctx.db, { capacity: 20, price: 150000 })` y tokens de USER, de un segundo USER con email `other@mail.com` y de ADMIN). Crear las reservas con `POST /reservations` o con `insertReservation` de `tests/helpers/events.ts`, y cubrir estos casos:
  - Reserva recién creada por el mismo USER: `200` y `res.body` igual (`toEqual`) al cuerpo que devolvió `POST /reservations`.
  - Con `expireReservations(ctx.db)` antes de consultar: `200` con `status` `EXPIRED`. Además, en la BD la reserva sigue `ACTIVE` y el seat sigue `RESERVED`, lo que comprueba que la consulta no escribe (`seatOf(...)` y una consulta a `reservations`).
  - `insertReservation(..., { status: 'CONFIRMED', seatStatus: 'SOLD' })`: `200` con `CONFIRMED`.
  - Reserva creada y luego `POST /events/:id/cancel` con el ADMIN: `200` con `CANCELLED`.
  - Reserva del segundo USER consultada con el primer token: `403` con `code` `FORBIDDEN`, y el cuerpo no contiene `seat` ni `amount`.
  - Con `adminToken`: `403` con `FORBIDDEN`.
  - Sin token: `401` con `UNAUTHORIZED`.
  - `crypto.randomUUID()`: `404` con `RESERVATION_NOT_FOUND`.
  - `/reservations/abc`: `400` con `VALIDATION_ERROR`.

  Verificar con `pnpm test tests/integration/reservations-routes.test.ts` (requiere Docker)
- [x] 3.3 En `tests/integration/reservations-e2e.test.ts` (el flujo crea un evento, reserva, lista los seats y vence la reserva), agregar dos verificaciones con el mismo token del flujo:
  - Justo después del `POST /reservations`, `GET /reservations/:id` devuelve `ACTIVE`.
  - Después de vencer la reserva y de que el listado de seats la libere, devuelve `EXPIRED`.

  Verificar con `pnpm test tests/integration/reservations-e2e.test.ts`

## 4. Documentación y cierre

- [x] 4.1 En `docs/business-rules.md`:
  - Agregar la regla RN-RES-8: "Un USER puede consultar solo sus propias reservas; una reserva `ACTIVE` con `expires_at <= now()` se informa como `EXPIRED` sin modificarla".
  - En la tabla de permisos, agregar la fila "Consultar mi reserva", solo para USER.

  Verificar leyendo las secciones 2 y 5
- [x] 4.2 En `docs/architecture.md`:
  - §11.2: fila `GET /reservations/:id` (USER), con éxito `200` y errores `400`, `401`, `403 FORBIDDEN` y `404 RESERVATION_NOT_FOUND`.
  - §11.3: indicar que responde el mismo cuerpo que `POST /reservations`, con el estado efectivo.

  Verificar leyendo ambas tablas
- [x] 4.3 En `README.md`, agregar la fila `GET /reservations/:id` | USER | Consulta una reserva propia con su estado efectivo (`EXPIRED` si ya venció). Verificar con `pnpm lint`
- [x] 4.4 Correr `pnpm lint`, `pnpm build`, `pnpm arch` y `pnpm test` completos. Verificar que todo pasa y probar a mano con `docker compose up -d --build`: reservar con curl, consultar `GET /reservations/<id>` con el mismo token y con el de otro usuario
