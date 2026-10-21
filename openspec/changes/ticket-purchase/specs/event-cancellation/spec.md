## MODIFIED Requirements

### Requirement: Tickets del evento
Al cancelar, el sistema SHALL pasar a `CANCELLED_BY_EVENT` los tickets `ISSUED` del evento y marcar sus pagos como `REFUND_PENDING`, y la respuesta SHALL incluir `cancelledTickets` con la cantidad de tickets cancelados. Los tickets no se eliminan. MUST NOT modificarse tickets de otros eventos. Mientras no existan tickets emitidos en el evento, `cancelledTickets` MUST ser 0.

#### Scenario: Evento sin tickets
- **WHEN** se cancela un evento sin tickets emitidos
- **THEN** `cancelledTickets` es 0

#### Scenario: Evento con tickets vendidos
- **WHEN** se cancela un evento con 3 tickets `ISSUED`
- **THEN** los 3 quedan `CANCELLED_BY_EVENT`, sus pagos quedan `REFUND_PENDING` y `cancelledTickets` es 3

#### Scenario: Otro evento intacto
- **WHEN** se cancela un evento
- **THEN** los tickets y pagos de los demás eventos no cambian

#### Scenario: Tickets conservados
- **WHEN** un evento fue cancelado
- **THEN** sus tickets siguen existiendo y aparecen en `GET /tickets/me` con `status` `CANCELLED_BY_EVENT`
