# Plataforma de Tickets – Arquitectura del producto (MVP)

Documento complementario de `business-rules.md`. Define el stack, la estructura de carpetas y las reglas de comunicación entre capas de `ticket-api`, y su relación con `payment-gateway`.

## 1. Visión general

```
Client --JWT--> ticket-api --HTTP + API key--> payment-gateway --> PostgreSQL (propia)
                    |
                    +--> PostgreSQL (ticket-api)
```

| Componente | Descripción | Ubicación |
|---|---|---|
| `ticket-api` | Auth, eventos, seats, reservas y tickets | Este repositorio |
| `payment-gateway` | Pasarela de pagos simulada, con BD propia | `/home/juandezmo/Documents/payment-gateway-microservice-project` |

El contrato entre ambos está en la sección 8 de `business-rules.md`.

## 2. Stack de `ticket-api`

| Necesidad | Tecnología |
|---|---|
| Runtime | Node 22 |
| Framework | Express 5 |
| Lenguaje | TypeScript (ESM), con JavaScript moderno |
| Gestor de dependencias | pnpm |
| Base de datos | PostgreSQL |
| Acceso a datos | Kysely + `pg` (migraciones de Kysely, tipos con `kysely-codegen`) |
| Validación y variables de entorno | zod |
| Autenticación | JWT con `jsonwebtoken` |
| Hash de contraseñas | argon2 |
| Logs | pino |
| Cliente HTTP a la pasarela | `fetch` nativo con `AbortSignal.timeout` |
| Contenedores | Docker y docker-compose |
| Calidad | ESLint, Prettier, tsx (desarrollo) |

## 3. Convenciones

- Código, nombres, mensajes de respuesta de la API, logs y tests en inglés.
- Documentos (OpenSpec, README, `docs/`) y comentarios necesarios en el código en español.
- Archivos en `kebab-case` con sufijo por rol: `event.service.ts`, `event.repository.ts`.
- Sin literales de negocio en `service` ni `controller`: estados, códigos y mensajes de error van en constantes y enums.
- Principios SOLID aplicados de forma sencilla (sección 6).

## 4. Estructura de carpetas

```
ticket-api/
  src/
    app.ts                  crea la app: middlewares, rutas, manejador de errores
    server.ts               arranca el servidor
    container.ts            crea las instancias y las conecta (inyección manual)
    config/
      env.ts                variables de entorno validadas con zod
    db/
      database.ts           instancia de Kysely
      types.ts              tipos de las tablas (kysely-codegen)
      migrations/           migraciones de Kysely
    shared/
      errors/               AppError, ErrorCode (códigos y mensajes en inglés)
      middleware/           authenticate, requireRole, validate, errorHandler
      utils/
    modules/
      auth/                 registro y login (JWT)
      users/
      events/               crear, listar, cancelar
      seats/                generar y listar seats
      reservations/
      tickets/              compra y mis tickets
      payments/             cliente HTTP de la pasarela
  tests/
    unit/
    integration/
    architecture/
  Dockerfile
  docker-compose.yml
  .env.example
  tsconfig.json
  eslint.config.js
  vitest.config.ts
```

### Archivos de cada módulo

Todos los módulos siguen el mismo patrón:

```
modules/events/
  event.routes.ts        rutas y middlewares
  event.controller.ts    HTTP: lee el request, llama al servicio y responde
  event.service.ts       reglas de negocio
  event.repository.ts    consultas Kysely
  event.schemas.ts       validación de entrada (zod)
  event.types.ts         tipos del módulo
```

Crecer significa añadir un módulo nuevo con esos mismos archivos, sin tocar los existentes.

## 5. Comunicación entre capas

```
routes -> controller -> service -> repository -> Kysely / PostgreSQL
```

| Capa | Responsabilidad | No debe |
|---|---|---|
| `routes` | Declarar rutas y middlewares (`authenticate`, `requireRole`, `validate`) | Contener lógica |
| `controller` | Leer el request, llamar al service y responder con el código HTTP | Tener lógica de negocio ni acceder a la BD |
| `service` | Reglas de negocio y transacciones | Conocer `req`, `res` ni `express` |
| `repository` | Consultas con Kysely | Aplicar reglas de negocio |

Reglas:
1. Un service puede usar el service de otro módulo, nunca su repository.
2. Las transacciones (reservar, comprar, cancelar evento) se abren en el service con `db.transaction()` y se pasan a los repositories.
3. Los errores se lanzan como `AppError` con un `ErrorCode` y los traduce un único `errorHandler`.
4. El mapeo a códigos HTTP vive solo en el controller y en el `errorHandler`.

## 6. SOLID aplicado

| Principio | Cómo se aplica |
|---|---|
| S | Un archivo por responsabilidad: rutas, controller, service, repository y schemas |
| O | Errores y roles por código, sin condicionales dispersos |
| L | Las implementaciones respetan la interfaz que reemplazan (real y mock) |
| I | Interfaces pequeñas por repository y por cliente de la pasarela |
| D | Los services reciben interfaces por constructor, ensambladas en `container.ts`. `PaymentGateway` es una interfaz con `HttpPaymentGateway` para producción y un mock para pruebas |

## 7. Integración con la pasarela

- El módulo `payments` expone la interfaz `PaymentGateway` y su implementación `HttpPaymentGateway`.
- Usa `PAYMENT_GATEWAY_URL` y `PAYMENT_GATEWAY_API_KEY` (variables de entorno, ver RN-PAY-7).
- Aplica timeout de 5 s con `AbortSignal.timeout` (`PAYMENT_GATEWAY_TIMEOUT_MS`, configurable) y convierte la respuesta HTTP en un resultado interno según la tabla 8.7 de `business-rules.md`.
- El `service` de tickets solo conoce la interfaz, nunca `fetch`.
- Registro de cobros: la tabla `payments` guarda `transactionId`, monto y estado (`APPROVED` o `REFUND_PENDING`); nunca datos de tarjeta. Un cobro aprobado que no puede convertirse en ticket (evento cancelado, reserva liberada o fallo inesperado) queda `REFUND_PENDING`. Los tickets cancelados por un evento también dejan su pago `REFUND_PENDING`.
- Pruebas con MSW: los handlers parten de los ejemplos del `openapi.json` de la pasarela.
- Sin reintentos automáticos (RN-TKT-11): una llamada por intento del usuario. Un timeout se trata como error temporal y la reserva sigue `ACTIVE`; reintentar es seguro por la idempotencia de la pasarela.

## 8. Expiración de reservas

La reserva guarda `expires_at` (creación + `RESERVATION_TTL_MINUTES`), calculado con `now()` de la BD. Es la fuente de verdad.

`releaseExpired(eventId?)` es una operación del módulo `reservations`, ejecutada en una transacción:
```
UPDATE reservations SET status='EXPIRED' WHERE status='ACTIVE' AND expires_at <= now()
UPDATE seats SET status='AVAILABLE' WHERE id IN (seats de esas reservas)
```

| Dónde se ejecuta | Cuándo | Para qué |
|---|---|---|
| Lazy | Al inicio de listar seats disponibles y de reservar en un evento | Nadie ve un seat ocupado por una reserva vencida |
| Job (`setInterval`, 60 s) | Arranca con `server.ts` | Limpieza general de eventos que nadie consulta |

```
Reservar -> releaseExpired(evento) -> UPDATE seat AVAILABLE->RESERVED (condicional) -> crea reserva con expires_at
Comprar  -> ¿expires_at > now()? no -> RESERVATION_EXPIRED; sí -> pagar
Cada 60s -> releaseExpired()
```

- La reserva atómica es un `UPDATE ... WHERE status='AVAILABLE'`; si afecta 0 filas, el seat ya no está libre.
- Índice parcial sobre `reservations(expires_at) WHERE status = 'ACTIVE'`.
- Con varias instancias el job es seguro: el `UPDATE` es idempotente.
- Costo: una consulta indexada por ejecución, normalmente con 0 filas. Si la carga crece, se puede quitar el lazy y dejar solo el job, aceptando hasta 60 s de seats mostrados como ocupados.
- Alternativas descartadas: solo validar al consultar (deja seats en `RESERVED`), `setTimeout` por reserva (se pierde al reiniciar), Redis con TTL (infraestructura extra) y `pg_cron` (acopla a una extensión).

## 9. Estrategia de pruebas

| Nivel | Qué prueba | Herramientas |
|---|---|---|
| Unitarias | Services con repositories y pasarela simulados | Vitest |
| Integración | Rutas, repositories, transacciones e índices contra PostgreSQL real | Vitest, supertest, Testcontainers PostgreSQL |
| Pasarela simulada | Respuestas 200, 402, 422, 502, 400, 401 y timeout. Los handlers de MSW parten de los ejemplos del contrato `openapi.json` de la pasarela | MSW (única herramienta de mock) |
| Arquitectura | Que las capas y los módulos respeten las dependencias | dependency-cruiser |

Reglas que hace cumplir `dependency-cruiser`:
- `controller` no importa `repository`.
- `service` no importa `express`.
- Un módulo no importa el `repository` de otro.
- Sin ciclos entre módulos.

## 10. Docker

- `Dockerfile` multi-stage (build y runtime), con usuario no root.
- `docker-compose.yml` con `postgres` (healthcheck y volumen) y `ticket-api` con `depends_on: service_healthy`.
- Variables en `.env`, con `.env.example` versionado: `DATABASE_URL`, `JWT_SECRET`, `PAYMENT_GATEWAY_URL`, `PAYMENT_GATEWAY_API_KEY`, `PAYMENT_GATEWAY_TIMEOUT_MS`, `RESERVATION_TTL_MINUTES`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `RESERVATION_EXPIRY_INTERVAL_SECONDS`.

## 11. Contrato de la API de `ticket-api`

### 11.1 Convenciones

- Un recurso se devuelve como objeto directo; las listas van dentro de `data` (permite añadir paginación sin romper el contrato).
- IDs en UUID, fechas en ISO 8601 UTC y montos como número.
- Nunca se devuelven contraseñas, hash ni datos de tarjeta.
- Errores con el formato `{ "code": "...", "message": "..." }`, con el mensaje en inglés y un `ErrorCode` por caso. Cualquier error no controlado responde `500` `INTERNAL_ERROR` con mensaje genérico.

### 11.2 Códigos de respuesta

| Endpoint | Éxito | Errores |
|---|---|---|
| `POST /auth/register` | 201 | 400 datos inválidos o `role` enviado, 409 email ya existe |
| `POST /auth/login` | 200 | 400, 401 credenciales inválidas |
| `POST /users` (ADMIN) | 201 | 400, 401, 403, 409 email ya existe |
| `GET /events` (público) | 200 | 400 paginación o filtros inválidos (`pageSize` fuera de 1 a 20, `page` menor a 1, tipo o fechas inválidos) |
| `POST /events` (ADMIN) | 201 | 400, 401, 403 |
| `GET /events/:id` (público) | 200 | 400 (id inválido), 404 `EVENT_NOT_FOUND` |
| `GET /events/:id/seats` | 200 | 401, 404 |
| `POST /events/:id/cancel` (ADMIN) | 200 | 400 (id inválido), 401, 403, 404 `EVENT_NOT_FOUND`, 409 `EVENT_ALREADY_CANCELLED` o `EVENT_ALREADY_ENDED` |
| `POST /reservations` (USER) | 201 | 400 (`eventId` o `seat` ausentes o inválidos), 401, 403, 404 `EVENT_NOT_FOUND` o `SEAT_NOT_FOUND`, 409 `SEAT_NOT_AVAILABLE` o `EVENT_NOT_ACTIVE` (evento cancelado o ya iniciado) |
| `GET /reservations/:id` (USER, solo el dueño) | 200 | 400 (id inválido), 401, 403 `FORBIDDEN` (otro rol u otro usuario), 404 `RESERVATION_NOT_FOUND` |
| `POST /tickets/purchase` (USER) | 201 al emitir; 200 si la reserva ya tenía ticket (mismo ticket, sin nuevo cobro) | ver tabla siguiente |
| `GET /tickets/me` (USER) | 200 | 400 (paginación inválida), 401, 403 |

Compra (`POST /tickets/purchase`):

| Caso | HTTP | `code` |
|---|---|---|
| Ticket emitido | 201 | |
| `card.brand` ausente, vacío o nulo | 400 | `CARD_BRAND_REQUIRED`: "Card brand is required. Use VISA, MASTERCARD or AMEX" |
| `card.brand` fuera de `VISA`, `MASTERCARD`, `AMEX` | 400 | `CARD_BRAND_NOT_ALLOWED`: "Card brand not allowed. Use VISA, MASTERCARD or AMEX" |
| Otros datos de tarjeta inválidos (400 de la pasarela) | 400 | `VALIDATION_ERROR` |
| No es el dueño de la reserva | 403 | `FORBIDDEN` |
| Reserva no encontrada | 404 | `RESERVATION_NOT_FOUND` |
| Reserva vencida o no activa | 409 | `RESERVATION_EXPIRED` |
| Evento cancelado | 409 | `EVENT_CANCELLED` |
| Pago rechazado | 402 | `PAYMENT_REJECTED` |
| Tarjeta con problemas | 422 | `CARD_PROBLEM` |
| Error de la pasarela | 502 | `PAYMENT_GATEWAY_ERROR` |
| Timeout hacia la pasarela | 504 | `PAYMENT_GATEWAY_TIMEOUT` |
| API key rechazada por la pasarela (error de configuración) | 500 | `INTERNAL_ERROR`, mensaje genérico |

Otros `ErrorCode`: `CARD_BRAND_REQUIRED` y `CARD_BRAND_NOT_ALLOWED` (400), `UNAUTHORIZED` (401), `INVALID_CREDENTIALS` (401), `EMAIL_ALREADY_EXISTS` (409), `EVENT_NOT_FOUND` y `SEAT_NOT_FOUND` (404), `SEAT_NOT_AVAILABLE` (409), `EVENT_NOT_ACTIVE` (409), `EVENT_ALREADY_CANCELLED` y `EVENT_ALREADY_ENDED` (409).

### 11.3 Cuerpos de las respuestas exitosas

**`POST /auth/register`** → 201
```json
{ "id": "uuid", "email": "ana@mail.com", "role": "USER", "createdAt": "2026-10-20T15:00:00Z" }
```

**`POST /users`** → 201 (solicitud `{ "email", "password", "role": "USER" | "ADMIN" }`, respuesta con el mismo formato que el registro)
```json
{ "id": "uuid", "email": "boss@mail.com", "role": "ADMIN", "createdAt": "2026-10-20T15:00:00Z" }
```

**`POST /auth/login`** → 200
```json
{ "accessToken": "eyJ...", "tokenType": "Bearer", "expiresIn": 3600 }
```

**`POST /events`** → 201, **`GET /events/:id`** → 200 y **`GET /events`** → 200 (este último dentro de `data`, con `meta`). El detalle también devuelve los eventos `CANCELLED`
```json
{
  "id": "uuid", "name": "Rock Night", "description": "...", "type": "CONCERT",
  "venue": "Main Hall", "price": 150000, "capacity": 100,
  "startDate": "2026-12-01T20:00:00Z", "endDate": "2026-12-01T23:00:00Z",
  "createdAt": "2026-10-20T15:00:00Z", "status": "ACTIVE"
}
```

`GET /events` admite `page` (por defecto 1), `pageSize` (1 a 20, por defecto 20; un valor mayor responde `400`) y los filtros `status`, `type`, `startFrom`, `startTo` y `search`. La respuesta es:
```json
{ "data": [ { "...evento": "..." } ], "meta": { "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 } }
```

**`GET /events/:id/seats?status=AVAILABLE`** → 200
```json
{ "eventId": "uuid", "data": [ { "id": "uuid", "row": "A", "number": 1, "label": "A1", "status": "AVAILABLE" } ] }
```

**`POST /events/:id/cancel`** → 200 (`cancelledTickets` vale 0 hasta que exista `ticket-purchase`)
```json
{ "id": "uuid", "status": "CANCELLED", "cancelledReservations": 4, "cancelledTickets": 12 }
```

**`POST /reservations`** → 201. Solicitud: `{ "eventId": "uuid", "seat": "C7" }` (la etiqueta `A`-`Z` + `1`-`10`, en minúscula también se acepta; el monto nunca se envía; `amount` es el precio a pagar, calculado por el servidor, RN-TKT-9)
```json
{
  "id": "uuid", "eventId": "uuid", "seatId": "uuid", "seat": "C7",
  "status": "ACTIVE", "amount": 150000,
  "expiresAt": "2026-10-20T15:10:00Z", "createdAt": "2026-10-20T15:00:00Z"
}
```

**`GET /reservations/:id`** → 200 con el mismo cuerpo que `POST /reservations`. `status` es el estado efectivo: una reserva `ACTIVE` vencida según la hora de la BD se devuelve como `EXPIRED`, aunque el job todavía no la haya liberado; la consulta no modifica datos (RN-RES-8).

**`POST /tickets/purchase`** → 201 (200 con el mismo cuerpo si la reserva ya tenía ticket)

Solicitud: `{ "reservationId": "uuid", "card": { "brand": "VISA", "number": "...", "expiry": "12/28", "cvv": "123" } }`. `card.brand` es obligatoria (`VISA`, `MASTERCARD` o `AMEX`); si falta o no es válida, `ticket-api` responde `400` sin llamar a la pasarela, con un código y un mensaje específicos (ver la tabla de la compra).
```json
{
  "id": "uuid", "reservationId": "uuid", "eventId": "uuid", "seat": "C7",
  "status": "ISSUED", "amount": 150000, "transactionId": "txn_...",
  "issuedAt": "2026-10-20T15:05:00Z"
}
```

**`GET /tickets/me`** → 200, paginado con `page` y `pageSize` (1 a 20) y `meta` (un ticket de un evento cancelado aparece con `status: "CANCELLED_BY_EVENT"`)
```json
{
  "data": [ {
    "id": "uuid", "status": "ISSUED", "seat": "C7", "amount": 150000, "issuedAt": "2026-10-20T15:05:00Z",
    "event": { "id": "uuid", "name": "Rock Night", "venue": "Main Hall", "startDate": "2026-12-01T20:00:00Z" }
  } ],
  "meta": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

## 12. Pendientes

- Cambios OpenSpec de `ticket-api` (orden en la sección 9 de `business-rules.md`).
