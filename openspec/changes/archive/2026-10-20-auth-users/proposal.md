## Why

`ticket-api` no tiene código todavía. Este primer cambio deja la base ejecutable del proyecto y la identidad de los usuarios, de la que dependen todos los demás módulos: sin registro, login y roles no se pueden proteger la creación de eventos, las reservas ni las compras.

## What Changes

- Base del proyecto: Node 22, Express 5, TypeScript (ESM), pnpm, Docker y docker-compose con PostgreSQL, configuración validada por variables de entorno, logs y pruebas de arquitectura con dependency-cruiser.
- Convenciones transversales de la API: formato de error `{ code, message }`, errores no controlados como `500` genérico, validación de entrada con `400`, ruta no encontrada con `404` y endpoint de salud.
- Registro público de usuarios, siempre con rol `USER` (`POST /auth/register`).
- Creación de usuarios `USER` o `ADMIN` solo por un `ADMIN` (`POST /users`) y seed idempotente del primer `ADMIN` al arrancar.
- Login con emisión de JWT (`POST /auth/login`).
- Middlewares de autenticación (`authenticate`) y de autorización por rol (`requireRole`) reutilizables por los módulos siguientes.
- Primera migración de la BD: tabla `users`.

## Capabilities

### New Capabilities
- `api-foundation`: formato de errores, validación de entrada, rutas inexistentes, endpoint de salud y arranque con configuración obligatoria.
- `user-registration`: registro público como `USER`, email único y contraseña protegida.
- `admin-user-management`: creación de usuarios por un `ADMIN` y seed del primer `ADMIN`.
- `user-authentication`: login, JWT con `sub` y `role`, autenticación y autorización por rol.

### Modified Capabilities

Ninguna. Es el primer cambio del proyecto.

## Impact

- Código nuevo: todo `ticket-api` (estructura de `src/`, `tests/`, Dockerfile, docker-compose, configuración de herramientas).
- Sistemas: PostgreSQL propio de `ticket-api` y contenedores Docker.
- Variables de entorno: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN_SECONDS`, `PORT`, `LOG_LEVEL`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`.
- Los cambios siguientes (`events-seats`, `reservations`, `event-cancellation`, `ticket-purchase`) usan `authenticate`, `requireRole`, el manejo de errores y la estructura definidos aquí.
- Fuera de alcance: refresh tokens, recuperación de contraseña, verificación de email, bloqueo por intentos fallidos, listado o edición de usuarios, y cierre de sesión.
