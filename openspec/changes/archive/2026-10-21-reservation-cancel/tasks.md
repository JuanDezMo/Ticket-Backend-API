## 1. Base de datos y tipos

- [x] 1.1 Crear `src/db/migrations/006-add-reservation-cancelled-by-user.ts` según la decisión 2 del design:
  - `up`: `alterTable('reservations').dropConstraint('reservations_status_check')` y `addCheckConstraint` con los 5 estados.
  - `down`: `UPDATE reservations SET status = 'CANCELLED' WHERE status = 'CANCELLED_BY_USER'`, y después restaurar el `CHECK` con los 4 estados anteriores.

  Registrarla en `src/db/migrations/index.ts` como `'006-add-reservation-cancelled-by-user'`. Verificar con `pnpm build`
- [x] 1.2 En `src/modules/reservations/reservation.types.ts`, agregar `CANCELLED_BY_USER: 'CANCELLED_BY_USER'` a `RESERVATION_STATUSES`. Verificar con `pnpm build`
- [x] 1.3 En `src/shared/errors/error-code.ts`, agregar `RESERVATION_ALREADY_CANCELLED` (`409`, "Reservation has already been cancelled") y `RESERVATION_ALREADY_CONFIRMED` (`409`, "Reservation has already been paid"), junto a `RESERVATION_EXPIRED`. Verificar con `pnpm build`

## 2. Implementación

- [x] 2.1 En `src/modules/seats/seat.repository.ts`, agregar `releaseReserved(seatId, executor)`: `RESERVED → AVAILABLE`, con `where status = 'RESERVED'`, y devolver `boolean`. Agregarlo a la interfaz y exponerlo en `SeatService`. Verificar con `pnpm build`
- [x] 2.2 En `src/modules/reservations/reservation.repository.ts`, agregar `markCancelledByUser(id, executor)`: `UPDATE reservations SET status = 'CANCELLED_BY_USER' WHERE id = ? AND status = 'ACTIVE' AND expires_at > now()`, que devuelve `boolean`. Agregarlo a la interfaz con un comentario que diga que el vencimiento se decide con la hora de la BD. Verificar con `pnpm build`
- [x] 2.3 En `src/modules/reservations/reservation.service.ts`, agregar `async cancelByOwner(userId: string, id: string): Promise<PublicReservation>` según la decisión 4 del design: control de dueño fuera de la transacción; dentro, `events.findForShare` → `reservations.lockById` → decisión por estado → `markCancelledByUser` → `seats.releaseReserved`; después, la etiqueta del seat y `toPublicReservation`. Comentar en español el orden de bloqueos y por qué evita el interbloqueo con la cancelación del evento. Usar las constantes de `RESERVATION_STATUSES` y `EVENT_STATUSES`. Verificar con `pnpm build`
- [x] 2.4 En `src/modules/reservations/reservation.controller.ts`, agregar el handler `cancel`: lee `res.locals.params` como `ReservationIdParams` y `req.auth!.userId`, y responde `200` con `cancelByOwner`. Verificar con `pnpm build`
- [x] 2.5 En `src/modules/reservations/reservation.routes.ts`, registrar `router.post('/:id/cancel', authenticate, requireRole(ROLES.USER), validate(reservationIdParamsSchema, 'params'), controller.cancel)`. Verificar con `pnpm arch`, que debe pasar sin violaciones
- [x] 2.6 En `src/modules/tickets/ticket.service.ts`, según la decisión 7 del design:
  - En el paso 4, después del control de evento cancelado: si `reservation.status === RESERVATION_STATUSES.CANCELLED_BY_USER`, lanzar `RESERVATION_ALREADY_CANCELLED`.
  - En `issue()`: si `locked?.status === RESERVATION_STATUSES.CANCELLED_BY_USER`, registrar `REFUND_PENDING` y devolver `refund` con `RESERVATION_ALREADY_CANCELLED`.
  - El `code` de `IssueOutcome` ya es `ErrorCode`, así que no requiere cambios de tipo.

  Verificar con `pnpm build`

## 3. Pruebas unitarias

- [x] 3.1 En `tests/unit/error-codes.test.ts`, agregar los 2 códigos nuevos con su estado y mensaje. Verificar con `pnpm test tests/unit/error-codes.test.ts`
- [x] 3.2 En `tests/unit/reservation-service.test.ts`, extender `setup()`: `repo.lockById` y `repo.markCancelledByUser` configurables, `seats.releaseReserved` y `events.findForShare`. Agregar `describe('ReservationService.cancelByOwner')` con estos casos:
  - `ACTIVE` vigente: devuelve `CANCELLED_BY_USER` y la etiqueta `C7`, y llama a `markCancelledByUser` y `releaseReserved` con el `trx`.
  - `findForShare` se llama antes que `lockById`, con el `trx`.
  - `CANCELLED_BY_USER` → `RESERVATION_ALREADY_CANCELLED`.
  - `CONFIRMED` → `RESERVATION_ALREADY_CONFIRMED`.
  - `CANCELLED`, o el evento `CANCELLED` → `EVENT_CANCELLED`.
  - `EXPIRED`, o `markCancelledByUser` en `false` → `RESERVATION_EXPIRED`.
  - Otro `userId` → `FORBIDDEN`, sin abrir la transacción.
  - `findForPurchase` en `null` → `RESERVATION_NOT_FOUND`.
  - En todos los casos de error, no se llama a `releaseReserved`.

  Verificar con `pnpm test tests/unit/reservation-service.test.ts`
- [x] 3.3 En `tests/unit/ticket-service.test.ts`, agregar dos casos:
  - Reserva `CANCELLED_BY_USER` antes del cobro → `RESERVATION_ALREADY_CANCELLED`, sin llamar a `payments.charge`.
  - `lockById` devuelve `CANCELLED_BY_USER` en `issue()` → `RESERVATION_ALREADY_CANCELLED` y `recordRefundPending`.

  Verificar con `pnpm test tests/unit/ticket-service.test.ts`

## 4. Pruebas de integración (PostgreSQL real)

- [x] 4.1 En `tests/integration/database.test.ts`:
  - El `CHECK` acepta `CANCELLED_BY_USER` y rechaza un estado desconocido.
  - El `down` de la `006`, ejecutado con un `Migrator` hasta `005-create-payments-and-tickets`, convierte las reservas `CANCELLED_BY_USER` en `CANCELLED`; luego `migrateToLatest` vuelve a aplicarla.

  Verificar con `pnpm test tests/integration/database.test.ts` (requiere Docker)
- [x] 4.2 En `tests/integration/reservations-routes.test.ts`, agregar `describe('POST /reservations/:id/cancel')` con el mismo contexto del `describe('GET /reservations/:id')` (USER con `userId`, segundo USER y ADMIN). Cubrir estos casos:
  - El dueño cancela una reserva recién creada: `200` con `CANCELLED_BY_USER` y el resto del cuerpo igual al del `POST /reservations`; el seat queda `AVAILABLE` y `GET /reservations/:id` devuelve `CANCELLED_BY_USER`.
  - El segundo USER reserva el mismo seat después de la cancelación: `201`.
  - Cancelar dos veces: `409 RESERVATION_ALREADY_CANCELLED`.
  - `insertReservation(..., { status: 'CONFIRMED', seatStatus: 'SOLD' })`: `409 RESERVATION_ALREADY_CONFIRMED` y el seat sigue `SOLD`.
  - Después de `POST /events/:id/cancel`: `409 EVENT_CANCELLED` y el seat sigue `BLOCKED`.
  - Con `expireReservations(ctx.db)`: `409 RESERVATION_EXPIRED`, la reserva sigue `ACTIVE` y el seat `RESERVED`.
  - Reserva del segundo USER: `403 FORBIDDEN`, sin cambios en la BD.
  - ADMIN: `403`. Sin token: `401`. `crypto.randomUUID()`: `404 RESERVATION_NOT_FOUND`. `/reservations/abc/cancel`: `400 VALIDATION_ERROR`.

  Verificar con `pnpm test tests/integration/reservations-routes.test.ts`
- [x] 4.3 En `tests/integration/purchase-routes.test.ts`:
  - Agregar el caso `CANCELLED_BY_USER` antes del cobro: `409 RESERVATION_ALREADY_CANCELLED`, sin llamadas a la pasarela. El `it.each` actual de `EXPIRED` y `CANCELLED` no cambia.
  - Agregar la compra en vuelo, con el mismo patrón que "released while paying": dentro de `gateway.respondWith`, el dueño llama a `POST /reservations/:id/cancel` y luego la pasarela aprueba. Resultado: `409 RESERVATION_ALREADY_CANCELLED`, sin tickets, pago `REFUND_PENDING`, reserva `CANCELLED_BY_USER` y seat `AVAILABLE`.

  Verificar con `pnpm test tests/integration/purchase-routes.test.ts`
- [x] 4.4 Crear `tests/integration/reservation-cancel-race.test.ts`, con el patrón de `purchase-cancellation-race.test.ts` (varias rondas con `it.each`):
  - Varios usuarios con reservas `ACTIVE` cancelan sus reservas mientras el ADMIN cancela el evento, todo con `Promise.all`. Ninguna respuesta es `500`. Cada cancelación responde `200` o `409 EVENT_CANCELLED`. Al final todos los seats están `BLOCKED`, y cada reserva está `CANCELLED_BY_USER` si su cancelación respondió `200` o `CANCELLED` si respondió `409`.
  - El mismo usuario envía dos cancelaciones simultáneas de la misma reserva: una `200` y otra `409 RESERVATION_ALREADY_CANCELLED`.

  Verificar con `pnpm test tests/integration/reservation-cancel-race.test.ts`
- [x] 4.5 En `tests/integration/reservations-e2e.test.ts`, después de que `luis` reserva `A1` por segunda vez: `luis` la cancela (`200`), los seats disponibles vuelven a 20 y `ana` reserva `A1` (`201`). Verificar con `pnpm test tests/integration/reservations-e2e.test.ts`

## 5. Documentación y cierre

- [x] 5.1 En `docs/business-rules.md`:
  - RN-RES-5: agregar `CANCELLED_BY_USER`.
  - Nueva RN-RES-9: "El dueño puede cancelar su reserva `ACTIVE` y vigente con `POST /reservations/:id/cancel`. La reserva pasa a `CANCELLED_BY_USER` y el seat a `AVAILABLE` en una sola transacción. Si no se puede cancelar, se responde `409` con un código según el estado".
  - RN-TKT-14: agregar `RESERVATION_ALREADY_CANCELLED` cuando el dueño canceló la reserva durante el pago.
  - Tabla de permisos: fila "Cancelar mi reserva", solo USER.
  - Diagrama de estados del seat (sección 4): la flecha `TTL / cancelada` ya existe; agregar debajo la aclaración de que "cancelada" es la cancelación por el dueño (RN-RES-9), sin cambiar la flecha para no desalinear el diagrama.

  Verificar leyendo las secciones 2, 5 y 6
- [x] 5.2 En `docs/architecture.md`:
  - §11.2: fila `POST /reservations/:id/cancel` (USER, solo el dueño), con `200` y los errores `400`, `401`, `403`, `404` y `409` (`RESERVATION_ALREADY_CANCELLED`, `RESERVATION_ALREADY_CONFIRMED`, `RESERVATION_EXPIRED` o `EVENT_CANCELLED`).
  - Tabla de la compra: `409 RESERVATION_ALREADY_CANCELLED`.
  - Lista de "Otros `ErrorCode`": los 2 códigos nuevos.
  - §11.3: el cuerpo de la cancelación es el mismo que el de `POST /reservations`, con `status` `CANCELLED_BY_USER`, y `GET /reservations/:id` puede devolver ese estado.

  Verificar leyendo ambas tablas
- [x] 5.3 En `README.md`, agregar la fila `POST /reservations/:id/cancel` | USER | Cancela una reserva propia vigente y libera el seat (`CANCELLED_BY_USER`). Verificar con `pnpm lint`
- [x] 5.4 Correr `pnpm lint`, `pnpm build`, `pnpm arch` y `pnpm test` completos. Verificar que todo pasa y probar a mano con `docker compose up -d --build`: reservar, cancelar, volver a reservar el mismo seat y cancelar dos veces
