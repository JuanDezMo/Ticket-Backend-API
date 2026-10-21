## Context

Piezas que ya existen y se reutilizan:

- `ReservationRepository.findForPurchase(id)` devuelve `{ reservation, expired }` o `null`. `expired` se calcula en SQL con `expires_at <= now()`, es decir, con la hora de la BD, como exige RN-RES-6.
- `toPublicReservation(reservation, seatLabel)` arma la respuesta pública.
- `SeatService.findById(id)` devuelve el seat con `row` y `number`.
- La compra ya aplica el mismo control de dueño (`reservation.userId !== userId → FORBIDDEN`).

## Goals / Non-Goals

**Goals:**
- Consultar una reserva sin escribir en la BD y con el mismo criterio de vencimiento que la compra.

**Non-Goals:**
- Liberar la reserva vencida durante la consulta: eso sigue siendo trabajo del job y de la liberación al reservar o listar seats (RN-RES-6).

## Decisions

### 1. Reutilizar `findForPurchase` en lugar de una consulta nueva
El service llama a `this.reservations.findForPurchase(id)`. El nombre queda algo corto para el nuevo uso, pero la consulta es exactamente la necesaria. Renombrarlo, por ejemplo a `findWithExpiry`, tocaría el módulo de tickets y se deja como mejora opcional.
- *Alternativa:* un `findById` nuevo con un join a `seats` para traer la etiqueta. Se descarta: duplicaría el cálculo de `expired` y el repository de reservas consultaría una tabla de otro módulo.

### 2. La etiqueta del seat sale de `SeatService`
`ReservationService` ya recibe `SeatService` por constructor. Con `this.seats.findById(reservation.seatId)` obtiene el seat y arma la etiqueta `${row}${number}`. Así se respeta la regla "un service usa el service de otro módulo, nunca su repository".
- Si el seat no existe, lo que no debería pasar por la clave foránea, se lanza `AppError('INTERNAL_ERROR')` para no responder datos incompletos.

### 3. Estado efectivo en el service
`ReservationService.getForOwner(userId, id)`:
1. Si no la encuentra, lanza `RESERVATION_NOT_FOUND`.
2. Si `reservation.userId !== userId`, lanza `FORBIDDEN`. Este control va antes de cualquier otro dato, para no revelar nada de una reserva ajena.
3. Si `reservation.status === RESERVATION_STATUSES.ACTIVE && expired`, devuelve la reserva con `status: RESERVATION_STATUSES.EXPIRED`, sin escribir en la BD.
4. En cualquier otro caso devuelve el estado guardado.

Se usan las constantes de `RESERVATION_STATUSES`, sin literales.
- *Alternativa:* liberar la reserva en la consulta. Se descarta: un `GET` no debe tener efectos y la liberación ya tiene dos mecanismos.

### 4. Código para el no dueño: `403 FORBIDDEN`
Coincide con la compra (RN-TKT-1). Responder `404` ocultaría que la reserva existe, pero con IDs UUID el riesgo de enumeración es bajo y es preferible la coherencia con la compra.

### 5. Ruta y validación
- `router.get('/:id', authenticate, requireRole(ROLES.USER), validate(reservationIdParamsSchema, 'params'), controller.getById)`.
- `reservationIdParamsSchema = z.object({ id: z.uuid() })` en `reservation.schemas.ts`.
- El controller lee `res.locals.params.id` y `req.auth!.userId`, y responde `200`.

## Risks / Trade-offs

- [La reserva puede vencer justo después de responder `ACTIVE`] → la UI usa `expiresAt` para su cuenta regresiva y la compra vuelve a validar el vencimiento (RN-RES-7).
- [Hay dos consultas, reserva y seat] → son lecturas por clave primaria; el costo es despreciable.
