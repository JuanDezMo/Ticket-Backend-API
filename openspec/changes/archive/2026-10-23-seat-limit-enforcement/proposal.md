## Why

Con `maxSeatsPerUser` guardado en el evento (`event-seat-limit`), el backend debe **imponerlo**: hoy un cliente puede acaparar todos los seats de un evento llamando a la API, y reservar de nuevo cada vez que vencen. Un límite que solo vive en la UI no protege nada. Además, para pagar varios seats juntos (`group-purchase`) conviene que se reserven juntos y con el mismo vencimiento.

## What Changes

- **Reserva por lotes:** `POST /reservations` recibe `{ eventId, seats: ["C5", "C6"] }` (de 1 a `maxSeatsPerUser` seats, sin repetidos) y responde `201` con `{ reservations: [...] }`. Todas las reservas del lote se crean **en una sola transacción, con el mismo `expiresAt`**. Es todo o nada: si un seat no está disponible, no se reserva ninguno y el error indica cuál.
- **El campo `seat` (uno solo) desaparece** del contrato: el cuerpo es estricto y un cliente que envíe `seat` recibe `400`. Una reserva de un seat es un lote de uno. **BREAKING**, sin alias (decisión de no mantener compatibilidad: el único consumidor es el frontend propio).
- **Límite por evento:** antes de reservar se cuenta, para ese usuario y evento, las reservas `ACTIVE` vigentes más las `CONFIRMED`. Si esa cantidad más las solicitadas supera `maxSeatsPerUser`, responde `409 SEAT_LIMIT_REACHED` con el mensaje "You can hold up to N seats for this event". Las reservas vencidas, canceladas por el usuario o por el evento no cuentan.
- **Tope global por cuenta:** un usuario no puede tener más de `MAX_ACTIVE_HOLDS_PER_USER` reservas `ACTIVE` vigentes a la vez, sumando todos los eventos (variable de entorno, por defecto 8). Si lo supera, `409 HOLD_LIMIT_REACHED`. Las reservas ya compradas no cuentan.
- **Sin carreras:** el conteo y la inserción ocurren en la misma transacción con un bloqueo por usuario tomado **antes** de contar, y los seats se bloquean en un orden fijo (por id ascendente) para evitar interbloqueos.
- Un usuario puede tener varias reservas `ACTIVE` a la vez; cada lote tiene su propio vencimiento de 10 minutos. `GET /reservations/:id` y la cancelación individual no cambian.
- Códigos nuevos `SEAT_LIMIT_REACHED` y `HOLD_LIMIT_REACHED` en el catálogo de errores. Índice por (usuario, evento, estado) en `reservations`.
- Reglas en `docs/business-rules.md` y contrato en `docs/architecture.md` (§11).

## Fuera de alcance

- Pagar varias reservas en una sola compra (`group-purchase`).
- Renovar o extender el vencimiento de reservas existentes.
- Un endpoint para listar las reservas activas del usuario (el cliente conoce sus ids).
- Límite por día, por IP o contra cuentas múltiples.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `seat-reservation`: la creación pasa a ser por lote, con el límite por evento, el tope global por cuenta y la regla de qué se cuenta.

## Impact

- **Código:** `src/modules/reservations/*` (esquema, servicio, repositorio con conteo y bloqueo, controlador), `src/shared/errors/*`, `src/config/env.ts` (nueva variable), migración `004` editada (índice).
- **API:** el cuerpo de `POST /reservations` cambia (`seats` en lugar de `seat`) y la respuesta pasa a lista (**BREAKING**). Nuevos `409 SEAT_LIMIT_REACHED` y `409 HOLD_LIMIT_REACHED`.
- **Pruebas:** helpers y pruebas de integración que reservan; concurrencia del límite; atomicidad del lote.
- **Esfuerzo estimado:** 3 a 4 días con pruebas (lote 1,5 a 2, límite por evento 1, tope global 0,5).
- **Depende de:** `event-seat-limit`.
