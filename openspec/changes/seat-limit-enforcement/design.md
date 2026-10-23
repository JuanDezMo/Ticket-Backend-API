## Context

- **Estado actual:** `ReservationService.create` valida el evento (404 y 409 `EVENT_NOT_ACTIVE`), busca **un** seat por etiqueta (404 `SEAT_NOT_FOUND`) y, en una transacción, libera las vencidas del evento (`releaseExpired`), marca el seat `RESERVED` con un `UPDATE ... WHERE status = 'AVAILABLE'` e inserta la reserva. No cuenta nada: no existe ningún límite.
- **Cómo se arman los errores:** `AppError(code, message?)` usa el mensaje del catálogo (`error-code.ts`) o uno propio; `SEAT_LIMIT_REACHED` necesita el valor de N en el texto.
- **Reglas de arquitectura (`.dependency-cruiser.cjs`):** un servicio no usa el repositorio de otro módulo (`no-cross-module-repository`), así que el bloqueo por usuario vive en el repositorio de reservas, no en el de usuarios.
- **Dependencia:** `event-seat-limit` agrega `maxSeatsPerUser` al evento. `EventService.getById` ya lo devuelve.
- **Esta iteración cambia solo la creación.** `GET /reservations/:id`, la cancelación por el dueño y el job de vencimiento no cambian. La compra de un grupo es `group-purchase`.
- Modelo de datos y reglas: `docs/data-model.md`.

## Goals / Non-Goals

**Goals:**
- Que el límite por evento y el tope global **no se puedan saltar** ni con solicitudes simultáneas.
- Que un lote sea todo o nada y que sus reservas compartan vencimiento.
- Que la evolución sea pequeña: la mayoría de la lógica sigue en `ReservationService`.

**Non-Goals:**
- Renovar o extender vencimientos.
- Impedir el abuso con varias cuentas (límite por IP o similares).
- Cambiar la compra: sigue recibiendo una sola reserva hasta `group-purchase`. En el tiempo intermedio la compra de una reserva del lote funciona como hoy.

## Decisions

### 1. Contrato del lote
`createReservationSchema` pasa a `{ eventId, seats }`, donde `seats` es una lista de 1 a `MAX_SEATS_PER_USER` etiquetas (la constante de `event-seat-limit`), normalizadas a mayúscula, **sin repetidas después de normalizar** (`["C5","c5"]` es un error de validación). El esquema sigue siendo `.strict()`, así que `seat` o `amount` responden `400`. La respuesta es `{ reservations: [...] }` con el formato público de siempre (`toPublicReservation`), en el mismo orden solicitado.

### 2. Flujo y orden de las validaciones
1. Fuera de la transacción (solo lecturas): el evento existe (404) y está activo y sin iniciar (409 `EVENT_NOT_ACTIVE`); todos los seats existen (404 `SEAT_NOT_FOUND`), con una sola consulta por las posiciones.
2. Dentro de una transacción: **(a)** bloqueo por usuario, **(b)** `releaseExpired(evento)`, **(c)** límite del evento, **(d)** tope global, **(e)** bloqueo de los seats en orden y comprobación de que estén `AVAILABLE`, **(f)** marcarlos `RESERVED`, **(g)** insertar las reservas.

Los límites (c y d) van **antes** que la disponibilidad (e), como pide la spec: quien ya superó su límite lo sabe aunque el seat esté ocupado. Si se cancela el evento justo entre el paso 1 y la transacción, sus seats quedan `BLOCKED` y el paso (e) responde `SEAT_NOT_AVAILABLE`, el mismo comportamiento de hoy.

### 3. Bloqueo por usuario con un bloqueo de asesoría
`ReservationRepository.lockHoldsOf(userId, executor)` ejecuta `pg_advisory_xact_lock(hashtextextended('reservation-holds:' || userId, 0))`. Se libera solo al terminar la transacción, y serializa **todas** las creaciones del mismo usuario, tanto para el límite del evento como para el tope global (los dos conteos ocurren bajo el mismo bloqueo).
- *Alternativa:* `SELECT ... FROM users WHERE id = $1 FOR NO KEY UPDATE`. Es más visible, pero obliga al servicio de reservas a tocar `users` (viola `no-cross-module-repository`) o a exponer un método en el módulo de usuarios solo para esto.
- Dos usuarios distintos no se bloquean entre sí. Una colisión del hash (probabilidad despreciable en 64 bits) solo causaría una espera innecesaria, nunca un error.

### 4. Qué cuenta y cómo
Dos consultas, ambas con la hora de la base de datos (`now()`), nunca la del servidor:
- `countHoldsForEvent(userId, eventId)`: reservas con `status = 'CONFIRMED'` **o** `status = 'ACTIVE' AND expires_at > now()`.
- `countActiveHolds(userId)`: `status = 'ACTIVE' AND expires_at > now()`, de todos los eventos.
Una `ACTIVE` ya vencida (que el job no ha liberado) no cuenta. Ver `docs/data-model.md` para el razonamiento de por qué `CONFIRMED` equivale a un ticket emitido sin unir con `tickets`.

El mensaje de `SEAT_LIMIT_REACHED` se arma con el límite del evento ("You can hold up to N seats for this event"); `HOLD_LIMIT_REACHED` usa el mensaje fijo del catálogo.

### 5. Bloqueo ordenado de los seats
Para que dos lotes que se cruzan (`C5,C6` y `C6,C5`) no se bloqueen mutuamente, los seats se bloquean con `SELECT id, status FROM seats WHERE id = ANY($ids) ORDER BY id FOR UPDATE` (siempre por id ascendente), se verifica en memoria que todos estén `AVAILABLE` y, si no, se responde `SEAT_NOT_AVAILABLE` con las etiquetas afectadas. Luego un solo `UPDATE seats SET status = 'RESERVED' WHERE id = ANY($ids)`. Un `UPDATE` directo no garantiza el orden en que se toman los bloqueos de las filas, por eso no se usa.
- El índice único parcial `reservations_seat_active_key` queda como segunda defensa: una violación se traduce a `SEAT_NOT_AVAILABLE`, como hoy.

### 6. Un solo INSERT para el lote
`ReservationRepository.createMany` inserta todas las reservas con una sentencia, con `expires_at = now() + make_interval(...)`. `now()` es constante dentro de la transacción, así que todas comparten `created_at` y `expires_at` sin necesidad de una tabla de lotes. Se devuelven con `RETURNING *` y se reordenan según el orden solicitado.

### 7. Configuración y errores
`MAX_ACTIVE_HOLDS_PER_USER` en `env.ts` (`z.coerce.number().int().min(1).default(8)`), inyectado en `ReservationService` por `container.ts`, igual que el TTL. Se agrega a `docker-compose.yml`, `.env.example` y `docs/ci-cd.md`. `SEAT_LIMIT_REACHED` y `HOLD_LIMIT_REACHED` se agregan al catálogo con `409`.

### 8. Índices
En la migración `004-create-reservations`: `reservations_user_event_hold_idx ON (user_id, event_id) WHERE status IN ('ACTIVE','CONFIRMED')` para el conteo del evento y `reservations_user_active_idx ON (user_id) WHERE status = 'ACTIVE'` para el tope global. Son parciales para mantenerlos pequeños y porque las reservas vencidas o canceladas son la mayoría con el tiempo.

### 9. Liberación de vencidas sin esperas cruzadas
`releaseExpired` se ejecuta dentro del bloqueo del usuario, pero dos usuarios distintos pueden ejecutarlo a la vez sobre el mismo evento. Para que no se esperen entre sí: las reservas vencidas se seleccionan con `ORDER BY id FOR UPDATE SKIP LOCKED` (si otra transacción ya las está liberando, esta las salta) y los seats de esas reservas se bloquean también por id ascendente antes de liberarlos. Así comparten el orden del bloqueo de seats del lote (decisión 5). No hay falsos `SEAT_NOT_AVAILABLE`: al bloquear sus seats, el lote espera a que la otra transacción confirme y los lee ya `AVAILABLE`.
- *Alternativas descartadas:* quitar la liberación del flujo de reservar (un seat vencido seguiría `RESERVED` hasta un minuto) y un bloqueo por evento (serializa a todos los compradores del evento).

### 10. Consumidores internos
`tests/helpers/purchase.ts` (`reserveSeat`) envía `seats` y lee `body.reservations[0]`; los 9 sitios de pruebas que crean reservas por servicio o por HTTP; `scripts/verify-gateway.sh`; el `README` y la documentación.

## Risks / Trade-offs

- [Una carrera deja pasar el límite] → bloqueo por usuario antes de contar y pruebas con solicitudes en paralelo repetidas (ver tareas), incluidas las que cruzan lotes.
- [Interbloqueo entre lotes] → orden fijo de bloqueo de seats (decisión 5). `releaseExpired` se reescribe con `SKIP LOCKED` y bloqueo ordenado (decisión 9), y la prueba de concurrencia incluye reservas vencidas presentes.
- [Un usuario espera detrás de su propio bloqueo] → solo sus propias solicitudes simultáneas se serializan; el costo es de milisegundos.
- [BREAKING: `seat` desaparece de `POST /reservations`] → único consumidor: el frontend, que se actualiza en `web-multi-seat-hold`. Se actualizan en este cambio las pruebas, el script y los documentos.
- [El tope global depende de la configuración] → es un valor por despliegue (8 por defecto); cambiarlo no requiere migración, solo reiniciar.
- [Dos reservas del mismo evento con vencimientos distintos] → es la regla acordada (lote con vencimiento común, lotes distintos por separado); la compra de grupo la resuelve `group-purchase`.
- [Mientras no exista `group-purchase`, un lote de varias reservas solo se puede pagar de a una] → el despliegue de estos dos cambios debe coordinarse.
