## Context

Continúa `reservations`, `events-seats` y `auth-users`. Alcance en `proposal.md`; reglas en `docs/business-rules.md` (sección 7, RN-CAN-1 a RN-CAN-4) y contrato en `docs/architecture.md` (sección 11).

## Goals / Non-Goals

**Goals:**
- Cancelar un evento de forma atómica y consistente con sus seats y reservas.
- Dejar un punto claro donde `ticket-purchase` engancha la cascada sobre tickets.

**Non-Goals:**
- Reactivar eventos, reembolsos, notificaciones y la cascada sobre tickets (`ticket-purchase`).

## Decisions

**Módulo nuevo `cancellations`**
```
modules/cancellations/
  cancellation.routes|controller|service|schemas.ts
  cancellation-step.ts                  interfaz CancellationStep y tipos
  steps/block-seats.step.ts             envuelve SeatService.blockAllByEvent
  steps/cancel-reservations.step.ts     envuelve ReservationService.cancelActiveByEvent
```
La orquestación vive en un módulo propio porque `reservations` ya depende de `events`; si `EventService` llamara a `ReservationService` habría un ciclo. No tiene repository propio. La ruta se monta en `/events/:id/cancel`.

**Pasos de cancelación (segregación para SOLID).** `CancellationService` no conoce los services de `seats` ni de `reservations`: recibe una lista ordenada de pasos que implementan una interfaz mínima:
```
interface CancellationStep {
  readonly name: 'seats' | 'reservations' | 'tickets';
  execute(eventId: string, trx: Db): Promise<number>;   // cuántos registros afectó
}
```
- Pasos actuales: `BlockSeatsStep` y `CancelReservationsStep`, cada uno envolviendo a su service. Se registran en `container.ts` en este orden (el orden importa para la concurrencia; ver abajo).
- `CancellationService` marca el evento como cancelado y ejecuta los pasos dentro de la misma transacción, acumulando los conteos por `name`. La respuesta usa `counts.reservations ?? 0` y `counts.tickets ?? 0`.
- Con `ticket-purchase` solo se agrega un `CancelTicketsStep` (`name: 'tickets'`) al contenedor, sin modificar `CancellationService` (abierto/cerrado). Antes de esta segregación, el servicio llamaba directamente a los services concretos y habría que editarlo en cada cascada nueva.
- El servicio depende de `EventService` (el evento es el núcleo de la operación) y de la interfaz `CancellationStep`, no de los services de los otros módulos (inversión de dependencias, interfaz pequeña).

**Flujo de `CancellationService.cancel(eventId)`**
```
1. event = EventService.getById(eventId)          -> 404 EVENT_NOT_FOUND
2. status CANCELLED                                -> 409 EVENT_ALREADY_CANCELLED
   endDate <= ahora                                -> 409 EVENT_ALREADY_ENDED
3. db.transaction():
   a. EventService.markCancelled(id, trx)          UPDATE events SET status='CANCELLED' WHERE id=$1 AND status='ACTIVE'
                                                   0 filas -> 409 EVENT_ALREADY_CANCELLED
   b. para cada paso, en orden:
        BlockSeatsStep         UPDATE seats SET status='BLOCKED' WHERE event_id=$1 AND status <> 'BLOCKED'
        CancelReservationsStep releaseExpired(id, trx) y luego
                               UPDATE reservations SET status='CANCELLED' WHERE event_id=$1 AND status='ACTIVE'
4. respuesta { id, status: 'CANCELLED', cancelledReservations, cancelledTickets }
```
`cancelledTickets` vale 0 mientras no haya un `CancelTicketsStep` registrado (no existe el módulo de tickets).

**Concurrencia.**
- Dos cancelaciones: el `UPDATE ... WHERE status='ACTIVE'` del evento es la barrera; la segunda transacción obtiene 0 filas y responde `EVENT_ALREADY_CANCELLED`.
- Cancelación frente a una reserva: el orden de los pasos importa. Primero se bloquean los seats (si una reserva en curso tiene el seat bloqueado, el `UPDATE` espera a que confirme) y solo después se cancelan las reservas `ACTIVE`, de modo que la reserva ya confirmada se ve y se cancela. Una reserva que llega después encuentra el seat `BLOCKED` y falla con `SEAT_NOT_AVAILABLE`. Así nunca queda una reserva `ACTIVE` sobre un evento cancelado. El orden de registro de los pasos en `container.ts` queda comentado por esta razón.

**Métodos nuevos (todos aceptan el ejecutor de la transacción):** `EventRepository/Service.markCancelled`, `SeatRepository/Service.blockAllByEvent` (devuelve cuántos cambió) y `ReservationRepository/Service.cancelActiveByEvent` (devuelve cuántas canceló). Los estados salen de los enums existentes, sin literales en `service` ni `controller`.

**Validación y errores.** Parámetro `id` como UUID (`400` si no). Nuevos `ErrorCode`: `EVENT_ALREADY_CANCELLED` (409, "Event is already cancelled") y `EVENT_ALREADY_ENDED` (409, "Event has already ended"). Ruta con `authenticate` + `requireRole('ADMIN')`.

**Sin migraciones.** Se usan las tablas y constraints existentes (los `CHECK` de estado ya admiten `CANCELLED`, `BLOCKED`).

**Pruebas.** Unitarias del servicio con pasos simulados (orden de validaciones, reglas de elegibilidad, orden de ejecución de los pasos y que un paso adicional se ejecuta sin modificar el servicio); integración con Testcontainers: efecto en seats y reservas (incluidos `SOLD`, `CONFIRMED`, vencidas y otros eventos), atomicidad con un fallo inyectado, cancelaciones simultáneas y cancelación simultánea con reservas. La regla de `dependency-cruiser` cubre el módulo nuevo.

## Risks / Trade-offs

- [`cancelledTickets` siempre 0 por ahora] → contrato estable desde ya; `ticket-purchase` completa la cascada registrando un `CancelTicketsStep`.
- [El orden de los pasos es una configuración del contenedor, menos visible que el código] → comentario en `container.ts` y test de carrera que lo protege.
- [Dependencia del orden de las sentencias para la concurrencia] → queda documentado y cubierto por un test de carrera.
- [`endDate` evaluado con el reloj del servidor] → suficiente para esta regla; los vencimientos de reservas sí usan la hora de la BD.

## Migration Plan

Sin migraciones ni cambios de configuración. Despliegue directo; reversión retirando la ruta.

## Open Questions

- Ninguna que bloquee.
