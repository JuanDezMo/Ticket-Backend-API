# ticket-api

Backend de la plataforma de tickets (eventos, seats, reservas y compra de tickets).
Este README cubre los cambios `auth-users` (base del proyecto, registro, login y administración de usuarios) `events-seats` (eventos y seats), `reservations` (reservas con vencimiento) `event-cancellation` (cancelación de eventos) y `ticket-purchase` (compra de tickets con la pasarela de pagos).

Documentación de referencia: `docs/business-rules.md` (reglas de negocio) y `docs/architecture.md` (arquitectura y contrato de la API).

## Requisitos

- Node 22 y pnpm 12 (`corepack enable`)
- Docker y docker-compose

## Levantar el proyecto con Docker

```bash
cp .env.example .env        # completar los valores (el .env no se versiona)
docker compose up -d --build
curl localhost:3000/health  # {"status":"UP"}
```

Al arrancar se aplican las migraciones y, si no existe ningún ADMIN, se crea el primero con
`SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`.

## Desarrollo local

```bash
pnpm install
docker compose up -d postgres     # PostgreSQL en localhost:5433
export DATABASE_URL=postgres://ticket:<POSTGRES_PASSWORD>@localhost:5433/ticket_api
export JWT_SECRET=<mínimo 16 caracteres>
export PAYMENT_GATEWAY_URL=http://localhost:8080      # pasarela de pagos (proyecto externo)
export PAYMENT_GATEWAY_API_KEY=<la misma key que usa la pasarela>
pnpm dev
```

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena de conexión a PostgreSQL |
| `JWT_SECRET` | Sí | Secreto para firmar los JWT (mínimo 16 caracteres) |
| `PAYMENT_GATEWAY_URL` | Sí | URL base de la pasarela de pagos. Desde Docker, una pasarela local es `http://host.docker.internal:8080` |
| `PAYMENT_GATEWAY_API_KEY` | Sí | API key que se envía como `Authorization: Bearer` a la pasarela |
| `PAYMENT_GATEWAY_TIMEOUT_MS` | No | Tiempo límite de la llamada a la pasarela, por defecto 5000 |
| `JWT_EXPIRES_IN_SECONDS` | No | Vida del token, por defecto 3600 |
| `PORT` | No | Puerto HTTP, por defecto 3000 |
| `LOG_LEVEL` | No | `info` por defecto |
| `RESERVATION_TTL_MINUTES` | No | Vigencia de una reserva en minutos, por defecto 10 |
| `RESERVATION_EXPIRY_INTERVAL_SECONDS` | No | Frecuencia del job que libera reservas vencidas, por defecto 60 |
| `SEED_ADMIN_EMAIL` | No | Email del primer ADMIN |
| `SEED_ADMIN_PASSWORD` | No | Contraseña del primer ADMIN (mínimo 8 caracteres) |

Si falta una variable obligatoria el proceso termina indicando cuál. El seed solo actúa si no existe
ningún ADMIN; cambiar estas variables después no modifica a un ADMIN existente.

## Pruebas de integración con la pasarela real

La suite automática (`pnpm test`) no necesita la pasarela. Para validar la integración contra el microservicio real hay un script y su documentación: [`docs/test-suite.md`](docs/test-suite.md) (cómo levantar primero la pasarela, luego `ticket-api`, y ejecutar `./scripts/verify-gateway.sh`).

## CI/CD con Jenkins y Docker

Un Jenkins local (`ci/jenkins/`) corre el `Jenkinsfile` en cada commit de `main`: lint, arch, build, pruebas con PostgreSQL real, imagen `ticket-api:<commit>`, smoke test y despliegue local con aprobación manual. Se levanta con `docker compose -f ci/jenkins/docker-compose.yml up -d --build` y queda en <http://127.0.0.1:8081>. Detalle en [`docs/ci-cd.md`](docs/ci-cd.md).

## Scripts

| Script | Descripción |
|---|---|
| `pnpm dev` | Servidor con recarga |
| `pnpm build` / `pnpm start` | Compilar a `dist/` y ejecutar |
| `pnpm test` | Pruebas (usan Testcontainers: requieren Docker) |
| `pnpm lint` | ESLint y Prettier |
| `pnpm arch` | Reglas de arquitectura (dependency-cruiser) |
| `pnpm db:codegen` | Regenera `src/db/types.ts` desde la BD migrada (requiere `DATABASE_URL`) |

## Endpoints

| Método y ruta | Acceso | Descripción |
|---|---|---|
| `GET /health` | Público | `200 {"status":"UP"}` o `503 {"status":"DOWN"}` |
| `POST /auth/register` | Público | Crea un usuario `USER`. Body: `email`, `password` (mínimo 8). No acepta `role` |
| `POST /auth/login` | Público | Devuelve `accessToken`, `tokenType` y `expiresIn` |
| `POST /users` | ADMIN | Crea un usuario `USER` o `ADMIN`. Body: `email`, `password`, `role` |
| `POST /events` | ADMIN | Crea un evento y genera sus seats. Body: `name`, `description`, `type`, `venue`, `price`, `capacity` (1 a 260), `startDate`, `endDate` |
| `GET /events` | Público | Lista eventos (incluye cancelados) paginados. Query: `page`, `pageSize` (1 a 20), `status`, `type`, `startFrom`, `startTo`, `search` |
| `GET /events/:id` | Público | Detalle de un evento (incluye cancelados) |
| `POST /reservations` | USER | Reserva un seat. Body: `eventId` y `seat` (etiqueta `A`-`Z` + `1`-`10`, por ejemplo `C7`). Devuelve la reserva con `amount` (precio del evento, calculado por el servidor) y `expiresAt` |
| `POST /reservations/:id/cancel` | USER | Cancela una reserva propia vigente y libera el seat (`CANCELLED_BY_USER`) |
| `GET /reservations/:id` | USER | Consulta una reserva propia con su estado efectivo (`EXPIRED` si ya venció) |
| `POST /events/:id/cancel` | ADMIN | Cancela el evento (no lo elimina): seats a `BLOCKED` y reservas `ACTIVE` a `CANCELLED`. Devuelve `{ id, status, cancelledReservations, cancelledTickets }` |
| `POST /tickets/purchase` | USER | Paga una reserva y emite el ticket. Body: `reservationId` y `card` (`brand`, `number`, `expiry`, `cvv`). `201` al emitir; `200` con el mismo ticket si la reserva ya estaba pagada |
| `GET /tickets/me` | USER | Mis tickets, paginados (`page`, `pageSize` de 1 a 20), con los de eventos cancelados como `CANCELLED_BY_EVENT` |
| `GET /events/:id/seats` | Autenticado | Seats del evento ordenados (`A1`, `A2`...). Query opcional: `status` (`AVAILABLE`, `RESERVED`, `SOLD`, `BLOCKED`) |

Errores con el formato `{ "code": "...", "message": "..." }`.

Los seats se generan en filas de 10 puestos desde la `A`: un evento de 25 puestos tiene `A1..A10`, `B1..B10` y `C1..C5`.
Un `pageSize` mayor a 20 (o menor a 1) responde `400`; no se recorta.

Los seats se generan en filas de 10 puestos desde la `A`: un evento de 25 puestos tiene `A1..A10`, `B1..B10` y `C1..C5`.
`pageSize` mayor a 20 (o menor a 1) responde `400`; no se recorta.

### Ejemplo con curl

```bash
# Login del ADMIN del seed
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"<SEED_ADMIN_PASSWORD>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

# El ADMIN crea otro ADMIN
curl -X POST localhost:3000/users -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"boss2@example.com","password":"password-123","role":"ADMIN"}'

# Registro público (siempre USER)
curl -X POST localhost:3000/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","password":"password-123"}'
```

### Eventos y seats

```bash
# El ADMIN crea un evento de 25 puestos (las fechas deben ser futuras)
curl -X POST localhost:3000/events -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Rock Night","description":"Concierto","type":"CONCERT","venue":"Main Hall","price":150000,"capacity":25,"startDate":"2027-01-15T20:00:00Z","endDate":"2027-01-15T23:00:00Z"}'

# Listado público con filtros y paginación
curl "localhost:3000/events?type=CONCERT&search=rock&page=1&pageSize=10"

# Seats disponibles (requiere token; <EVENT_ID> es el id devuelto al crear el evento)
curl "localhost:3000/events/<EVENT_ID>/seats?status=AVAILABLE" -H "Authorization: Bearer $TOKEN"
```

### Reservas

```bash
# Un USER reserva el seat C7 de un evento (el monto lo calcula el servidor)
curl -X POST localhost:3000/reservations -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"eventId":"<EVENT_ID>","seat":"C7"}'
```

La reserva dura `RESERVATION_TTL_MINUTES`. Las reservas vencidas se liberan al reservar, al listar los seats del evento y por un job
periódico, así que el seat vuelve a `AVAILABLE`. Respuestas de error: `404` `EVENT_NOT_FOUND` / `SEAT_NOT_FOUND`,
`409` `SEAT_NOT_AVAILABLE` / `EVENT_NOT_ACTIVE`.

### Compra de tickets

```bash
# El USER paga su reserva con tarjeta; el monto lo calcula el servidor (el del evento)
curl -X POST localhost:3000/tickets/purchase -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"reservationId":"<RESERVATION_ID>","card":{"brand":"VISA","number":"4111111111111111","expiry":"12/28","cvv":"123"}}'

# Mis tickets
curl "localhost:3000/tickets/me?page=1&pageSize=10" -H "Authorization: Bearer $USER_TOKEN"
```

Reglas a tener en cuenta:
- Para probar contra la pasarela real hay que levantarla (`PAYMENT_GATEWAY_URL`). Con ella, una tarjeta que termina en `0000` se rechaza (`402`) y en `9999` simula un error (`502`, y al tercer intento `422`).
- La franquicia (`card.brand`) es obligatoria y solo admite `VISA`, `MASTERCARD` o `AMEX` (en minúscula también se acepta). Si falta responde `400` `CARD_BRAND_REQUIRED` ("Card brand is required. Use VISA, MASTERCARD or AMEX"); si no es una de las tres, `400` `CARD_BRAND_NOT_ALLOWED` ("Card brand not allowed. Use VISA, MASTERCARD or AMEX"). En ambos casos no se llama a la pasarela.
- Respuestas cuando el pago no se aprueba: `402` `PAYMENT_REJECTED`, `422` `CARD_PROBLEM`, `502` `PAYMENT_GATEWAY_ERROR`, `504` `PAYMENT_GATEWAY_TIMEOUT` (límite de `PAYMENT_GATEWAY_TIMEOUT_MS`). La reserva sigue activa para reintentar; no hay reintentos automáticos.
- `409` `RESERVATION_EXPIRED` si la reserva venció o ya no está activa, y `409` `EVENT_CANCELLED` si el evento fue cancelado.
- Repetir la compra de una reserva ya pagada devuelve `200` con el mismo ticket, sin cobrar de nuevo.
- Si el evento se cancela (o la reserva se libera) mientras se paga, no se emite el ticket y el pago queda registrado como `REFUND_PENDING`.
- `ticket-api` no guarda ni registra el número, el vencimiento ni el CVV de la tarjeta.

### Cancelación de eventos

```bash
# El ADMIN cancela un evento (no se elimina; sigue apareciendo en GET /events con status CANCELLED)
curl -X POST localhost:3000/events/<EVENT_ID>/cancel -H "Authorization: Bearer $ADMIN_TOKEN"
# {"id":"<EVENT_ID>","status":"CANCELLED","cancelledReservations":2,"cancelledTickets":3}
```

Respuestas de error: `404` `EVENT_NOT_FOUND`, `409` `EVENT_ALREADY_CANCELLED` (ya cancelado) y `409` `EVENT_ALREADY_ENDED` (su `endDate` ya pasó).
Un evento que ya inició pero no ha terminado sí puede cancelarse. Los tickets vendidos pasan a `CANCELLED_BY_EVENT` y sus pagos quedan `REFUND_PENDING` (no hay reembolso automático); `cancelledTickets` cuenta cuántos fueron.

## Diseño: cancelación de eventos y SOLID

> Diseño del cambio `event-cancellation`. Estado: implementado.

`POST /events/:id/cancel` toca tres módulos a la vez: eventos, seats y reservas (y más adelante tickets). Para no crear ciclos entre
módulos, la coordinación vive en un módulo propio, `cancellations`, que no tiene repository.

### Cómo estaba (primera versión del diseño)

`CancellationService` llamaba directamente a los services concretos de cada módulo:

```
CancellationService
  |-- EventService.markCancelled(...)
  |-- SeatService.blockAllByEvent(...)
  |-- ReservationService.cancelActiveByEvent(...)
  (y, al llegar ticket-purchase, habría sido necesario editar este servicio para añadir TicketService.cancelByEvent(...))
```

Problemas frente a SOLID:

| Principio | Problema |
|---|---|
| Abierto/cerrado | Cada cascada nueva (tickets) obligaba a **editar** `CancellationService` |
| Inversión de dependencias | Dependía de tres services concretos de otros módulos |
| Segregación de interfaces | Usaba un método de cada service, pero conocía la clase completa |

### Cómo se segregó

La cascada se separó en **pasos** que implementan una interfaz mínima, y el servicio solo conoce esa interfaz:

```ts
interface CancellationStep {
  readonly name: 'seats' | 'reservations' | 'tickets';
  execute(eventId: string, trx: Db): Promise<number>; // cuántos registros afectó
}
```

```
CancellationService  --usa-->  EventService          (el evento es el núcleo de la operación)
        |
        +--usa-->  CancellationStep[]   (lista ordenada, ensamblada en container.ts)
                       |-- BlockSeatsStep          -> SeatService.blockAllByEvent
                       |-- CancelReservationsStep  -> ReservationService.cancelActiveByEvent
                       '-- CancelTicketsStep       -> TicketService.cancelByEvent  (añadido con ticket-purchase, sin tocar CancellationService)
```

Flujo, todo dentro de una sola transacción:

1. Se valida el evento (`404` si no existe, `409` si ya está cancelado o terminó).
2. Se marca el evento `CANCELLED` (UPDATE condicional: si dos ADMIN cancelan a la vez, solo uno lo logra).
3. Se ejecutan los pasos en el orden registrado y se acumulan los conteos por `name`.
4. La respuesta usa `cancelledReservations` (paso `reservations`) y `cancelledTickets` (paso `tickets`).

### Qué se gana

| Principio | Cómo se cumple ahora |
|---|---|
| **S** Responsabilidad única | `CancellationService` solo coordina; cada paso hace una cosa y cada módulo conserva sus reglas |
| **O** Abierto/cerrado | Añadir tickets = registrar un `CancelTicketsStep` en `container.ts`; `CancellationService` no se modifica |
| **L** Sustitución | Cualquier paso (real o simulado en tests) es intercambiable bajo la misma interfaz |
| **I** Segregación de interfaces | El servicio depende de una interfaz de dos miembros, no de clases completas |
| **D** Inversión de dependencias | Depende de la abstracción `CancellationStep`; los services concretos solo los conocen los pasos |

### Detalles a tener en cuenta

- **El orden de los pasos importa.** Primero se bloquean los seats y después se cancelan las reservas `ACTIVE`; así una reserva simultánea
  nunca queda activa sobre un evento cancelado. Por eso el orden de registro en `container.ts` está comentado y protegido por un test de carrera.
- `ReservationRepository.releaseExpired` modifica también `seats` para ser atómico: es una excepción consciente a "un repository solo toca su tabla".
- Costo del diseño: una interfaz y dos clases pequeñas más, a cambio de no tocar el servicio en cada cascada nueva.
