# ticket-api

Backend de la plataforma de tickets (eventos, seats, reservas y compra de tickets).
Este README cubre el estado del cambio `auth-users`: base del proyecto, registro, login y administración de usuarios.

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
pnpm dev
```

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena de conexión a PostgreSQL |
| `JWT_SECRET` | Sí | Secreto para firmar los JWT (mínimo 16 caracteres) |
| `JWT_EXPIRES_IN_SECONDS` | No | Vida del token, por defecto 3600 |
| `PORT` | No | Puerto HTTP, por defecto 3000 |
| `LOG_LEVEL` | No | `info` por defecto |
| `SEED_ADMIN_EMAIL` | No | Email del primer ADMIN |
| `SEED_ADMIN_PASSWORD` | No | Contraseña del primer ADMIN (mínimo 8 caracteres) |

Si falta una variable obligatoria el proceso termina indicando cuál. El seed solo actúa si no existe
ningún ADMIN; cambiar estas variables después no modifica a un ADMIN existente.

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

Errores con el formato `{ "code": "...", "message": "..." }`.

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
