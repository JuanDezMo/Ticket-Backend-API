## Context

Proyecto nuevo sin código. Motivación y alcance en `proposal.md`. Stack y estructura definidos en `docs/architecture.md`; contrato y códigos HTTP en su sección 11. Este cambio crea la base sobre la que se montan los demás módulos.

## Goals / Non-Goals

**Goals:**
- Proyecto ejecutable con `docker compose up` (API + PostgreSQL).
- Estructura por módulos y reglas de dependencia verificadas automáticamente.
- Autenticación y autorización reutilizables por los módulos siguientes.

**Non-Goals:**
- Refresh tokens, recuperación de contraseña, verificación de email, bloqueo por intentos fallidos y cierre de sesión.

## Decisions

**Estructura inicial**
```
src/
  app.ts  server.ts  container.ts
  config/env.ts
  db/database.ts  db/types.ts  db/migrations/
  shared/errors/  shared/middleware/  shared/utils/
  modules/auth/   modules/users/
```
Flujo `routes -> controller -> service -> repository -> Kysely`. `auth` orquesta registro y login y usa el `UserService` de `users`; nunca su repository. `users` expone `POST /users` (solo `ADMIN`) y contiene el seed. `container.ts` construye repositories, services y controllers por constructor.

**Express 5.** Los handlers `async` propagan sus errores al `errorHandler` sin envoltorios. `createApp(deps)` recibe el contenedor para poder probar la app sin levantar el servidor.

**Errores.** `AppError(code, httpStatus, message)` y un enum `ErrorCode` con los mensajes en inglés. Un único `errorHandler` serializa `{ code, message }`; los errores desconocidos se registran y devuelven `INTERNAL_ERROR` genérico. Un manejador de rutas desconocidas devuelve `NOT_FOUND`.

**Validación con zod.** Cada módulo define sus `*.schemas.ts`; el middleware `validate(schema)` falla con `VALIDATION_ERROR`. `config/env.ts` valida las variables al arrancar y aborta si faltan.

**Contraseñas con argon2** (hash con sal incluido). Alternativa: bcrypt; se prefiere argon2 por ser el algoritmo recomendado actualmente. Se encapsula en un `PasswordHasher` (interfaz) para poder sustituirlo en pruebas.

**JWT con `jsonwebtoken`.** Algoritmo HS256 con `JWT_SECRET`; claims `sub` y `role`, expiración `JWT_EXPIRES_IN_SECONDS` (3600 por defecto). Se encapsula en un `TokenService` (interfaz). Alternativa: tokens asimétricos, descartada por innecesaria con un solo servicio emisor y verificador.

**Autorización.** `authenticate` valida el Bearer y deja `req.auth = { userId, role }`. `requireRole(...roles)` compara el rol. Tipado de `req.auth` por extensión de los tipos de Express.

**Seed del primer ADMIN.** Servicio `AdminSeeder` ejecutado en el arranque, después de las migraciones: si no existe ningún `ADMIN` y están definidas `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`, lo crea con la contraseña hasheada. Es idempotente y seguro con varias instancias (la unicidad del email lo protege). Si faltan las variables y no hay `ADMIN`, registra un aviso y continúa. Alternativa: script manual `pnpm seed:admin`, descartada porque exige un paso aparte en `docker compose up`.

**Registro y creación de usuarios.** `POST /auth/register` usa un schema estricto que rechaza `role` (`400`) y crea siempre `USER`. `POST /users` (`authenticate` + `requireRole('ADMIN')`) acepta `role` obligatorio y reutiliza la misma operación de creación de `UserService`.

**Email.** Se normaliza a minúsculas antes de guardar y buscar; la unicidad se garantiza con un índice único en la BD y se captura su violación para devolver `EMAIL_ALREADY_EXISTS` (cubre solicitudes concurrentes).

**Datos.** Migración de Kysely con la tabla `users`: `id` (uuid), `email` (único, minúsculas), `password_hash`, `role` (`USER` o `ADMIN`) y `created_at`. Tipos generados con `kysely-codegen`. Instancia de Kysely creada en `db/database.ts`.

**Logs con pino**, con el nivel en `LOG_LEVEL`. Nunca se registran contraseñas, hashes ni tokens.

**Arquitectura con dependency-cruiser.** Reglas: el controller no importa el repository; el service no importa `express`; un módulo no importa el repository de otro; sin ciclos. Se ejecuta como script y dentro de `tests/architecture`.

**Docker.** Dockerfile multi-stage con usuario no root. `docker-compose.yml` con `postgres` (healthcheck y volumen) y `ticket-api` con `depends_on: service_healthy`. Las migraciones se ejecutan al arrancar. Variables en `.env`, con `.env.example` versionado.

**Pruebas.** Unitarias con Vitest (services con repository y hasher simulados); integración con supertest y Testcontainers PostgreSQL; arquitectura con dependency-cruiser.

## Risks / Trade-offs

- [Credenciales del seed en variables de entorno] → viven en `.env` fuera del repo (en producción, en un gestor de secretos); cambiar la contraseña de un usuario existente queda fuera del MVP.
- [`JWT_SECRET` débil o expuesto] → se exige por configuración, sin valor por defecto, y vive en `.env` fuera del repo.
- [Sin revocación de tokens ni refresh] → la expiración corta limita la ventana; fuera del MVP.
- [Mensaje único en credenciales inválidas] → evita enumerar usuarios, pero dificulta el soporte; se acepta.

## Migration Plan

Proyecto nuevo, sin datos previos. Las migraciones se aplican al iniciar. Reversión en desarrollo: eliminar el volumen de la BD.

## Open Questions

- Ninguna que bloquee: la política de contraseñas se limita a 8 caracteres mínimos para el MVP.
