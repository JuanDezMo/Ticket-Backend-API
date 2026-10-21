## ADDED Requirements

### Requirement: Reserva con seat inexistente en la consulta
Si `GET /reservations/:id` encuentra la reserva del dueño pero su seat no existe, el sistema MUST responder `500` con `code` `INTERNAL_ERROR` y el mensaje genérico, sin datos de la reserva, y SHALL registrar en el log el id del seat y el de la reserva, como cualquier error no controlado (ver `api-foundation`).

#### Scenario: Seat de la reserva inexistente
- **WHEN** el dueño consulta una reserva cuyo seat no existe
- **THEN** el sistema responde `500` con `code` `INTERNAL_ERROR` y el detalle, con el id del seat y el de la reserva, solo aparece en el log
