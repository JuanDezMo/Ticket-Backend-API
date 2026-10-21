## 1. Base de la cancelación

- [x] 1.1 Agregar `EVENT_ALREADY_CANCELLED` y `EVENT_ALREADY_ENDED` a `ErrorCode`; verificar con test unitario sus códigos HTTP (409) y mensajes en inglés
- [x] 1.2 Agregar `markCancelled(id, executor)` a `EventRepository` y `EventService` (UPDATE condicional a `ACTIVE`, devuelve si cambió una fila); verificar con tests de integración que un evento `ACTIVE` pasa a `CANCELLED` y que uno ya cancelado devuelve `false`
- [x] 1.3 Agregar `blockAllByEvent(eventId, executor)` a `SeatRepository` y `SeatService` (pasa a `BLOCKED` los seats que no lo estén y devuelve cuántos cambió); verificar con tests de integración que cambia `AVAILABLE`, `RESERVED` y `SOLD`, y que no toca seats de otros eventos
- [x] 1.4 Agregar `cancelActiveByEvent(eventId, executor)` a `ReservationRepository` y `ReservationService` (primero `releaseExpired`, luego `ACTIVE` pasa a `CANCELLED`, devuelve la cantidad); verificar con tests de integración: las vigentes se cancelan, la vencida queda `EXPIRED` y no se cuenta, y `CONFIRMED`, `EXPIRED` y reservas de otros eventos no cambian

## 2. Servicio de cancelación

- [x] 2.1 Definir la interfaz `CancellationStep` (`name` y `execute(eventId, trx)`) y los pasos `BlockSeatsStep` y `CancelReservationsStep`, cada uno envolviendo su service; verificar con tests unitarios que delegan en el service correcto con la transacción recibida y devuelven la cantidad afectada
- [x] 2.2 Implementar `CancellationService.cancel` (existencia, ya cancelado, ya terminado, transacción que marca el evento y ejecuta los pasos en orden, acumulando conteos por `name`); verificar con tests unitarios con pasos simulados: orden de las validaciones, `endDate` pasada responde `EVENT_ALREADY_ENDED`, un evento en curso sí se cancela, los pasos se ejecutan en el orden registrado, `cancelledReservations` sale del paso `reservations`, `cancelledTickets` es 0 sin paso `tickets`, y un paso adicional con `name` `tickets` se refleja en la respuesta sin modificar el servicio
- [x] 2.3 Verificar la atomicidad: con un fallo inyectado en el paso de reservas (después de bloquear los seats), el evento sigue `ACTIVE`, los seats conservan su estado y las reservas siguen `ACTIVE`

## 3. Endpoint

- [x] 3.1 Implementar `POST /events/:id/cancel` (schema del `id` como UUID, controller, routes, `authenticate` + `requireRole('ADMIN')`) con la respuesta `{ id, status, cancelledReservations, cancelledTickets }`; verificar con tests de integración `200` como ADMIN, `403` como USER, `401` sin token, `400` con id inválido, `404` `EVENT_NOT_FOUND`, `409` `EVENT_ALREADY_CANCELLED`, `409` `EVENT_ALREADY_ENDED` y `200` para un evento en curso
- [x] 3.2 Verificar los efectos de punta a punta con datos mixtos (seats `AVAILABLE`, `RESERVED` y `SOLD`; reservas vigente, vencida y confirmada; un segundo evento intacto): seats `BLOCKED`, `cancelledReservations` correcto y `GET /events` lista el evento como `CANCELLED`
- [x] 3.3 Verificar las operaciones posteriores: `POST /reservations` sobre el evento cancelado responde `409` `EVENT_NOT_ACTIVE` y `GET /events/:id/seats?status=AVAILABLE` devuelve `data` vacío

## 4. Concurrencia

- [x] 4.1 Verificar que dos cancelaciones simultáneas del mismo evento dan exactamente un `200` y un `409` `EVENT_ALREADY_CANCELLED`
- [x] 4.2 Verificar la carrera con reservas: lanzar varias reservas a la vez que la cancelación (repetido varias veces) y comprobar que al terminar el evento está `CANCELLED`, ninguna reserva del evento queda `ACTIVE` y ningún seat queda `RESERVED`

## 5. Cierre

- [x] 5.1 Registrar el módulo `cancellations` en `container.ts` (pasos en el orden seats y luego reservas, con un comentario que explica por qué) y en `app.ts`; verificar que `pnpm arch` pasa (sin ciclos entre módulos ni imports de repositories ajenos)
- [x] 5.2 Escribir el test de extremo a extremo (ADMIN crea evento, dos USER reservan, ADMIN cancela, las reservas quedan `CANCELLED`, el evento figura `CANCELLED`, no se puede reservar ni cancelar de nuevo); verificar que `pnpm test` pasa completo
- [x] 5.3 Actualizar el `README` en español con `POST /events/:id/cancel` y un ejemplo con `curl`, la nota de que `cancelledTickets` será 0 hasta `ticket-purchase`, y la sección de diseño (cómo estaba la orquestación y cómo se segregó en pasos para cumplir SOLID); verificar siguiendo el README contra `docker compose`
