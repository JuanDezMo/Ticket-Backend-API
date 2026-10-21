## 1. Proyecto base

- [x] 1.1 Inicializar el proyecto con pnpm, TypeScript (ESM, Node 22) y los scripts `dev`, `build`, `start`, `test` y `lint`; verificar que `pnpm build` compila sin errores
- [x] 1.2 Agregar dependencias (express 5, zod, kysely, pg, jsonwebtoken, argon2, pino y las de desarrollo: tsx, vitest, supertest, testcontainers, eslint, prettier, dependency-cruiser, kysely-codegen); verificar que `pnpm install` y `pnpm lint` pasan
- [x] 1.3 Crear la estructura de carpetas `src/` (`config`, `db`, `shared`, `modules/auth`, `modules/users`) y `tests/` (`unit`, `integration`, `architecture`); verificar que los archivos esperados existen

## 2. Configuración y esqueleto de la API

- [x] 2.1 Implementar `config/env.ts` con zod (`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN_SECONDS`, `PORT`, `LOG_LEVEL`, y `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` opcionales); verificar con tests unitarios que falta de `JWT_SECRET` o `DATABASE_URL` aborta con el nombre de la variable y que faltar las variables del seed no aborta
- [x] 2.2 Implementar `AppError`, `ErrorCode` (con mensajes en inglés) y el `errorHandler` con `NOT_FOUND`, `VALIDATION_ERROR` e `INTERNAL_ERROR`; verificar con tests que un error desconocido devuelve `500` genérico y no filtra trazas
- [x] 2.3 Implementar el middleware `validate(schema)` con zod; verificar con tests que un cuerpo inválido y un JSON malformado devuelven `400` `VALIDATION_ERROR`
- [x] 2.4 Implementar `createApp`, `server.ts`, `container.ts` y el logger pino; verificar con supertest que una ruta desconocida devuelve `404` `NOT_FOUND`
- [x] 2.5 Implementar `GET /health` que consulta la BD; verificar con test de integración `200 UP` con BD disponible y `503 DOWN` con la BD detenida

## 3. Docker

- [x] 3.1 Crear el Dockerfile multi-stage con usuario no root; verificar con `docker build` que la imagen se construye
- [x] 3.2 Crear `docker-compose.yml` con `postgres` (healthcheck y volumen) y `ticket-api` con `depends_on: service_healthy`, más `.env.example`; verificar que `docker compose up` deja ambos servicios sanos y `/health` responde `UP`

## 4. Base de datos

- [x] 4.1 Crear `db/database.ts` con la instancia de Kysely y la ejecución de migraciones al arrancar; verificar que las migraciones se aplican en un PostgreSQL de Testcontainers
- [x] 4.2 Crear la migración de `users` (`id` uuid, `email` único en minúsculas, `password_hash`, `role`, `created_at`) y generar `db/types.ts` con kysely-codegen; verificar que un email duplicado viola el índice único

## 5. Usuarios y registro

- [x] 5.1 Implementar `UserRepository` (crear y buscar por email o id) y `UserService`; verificar con tests de integración que el email se guarda en minúsculas y que un duplicado se traduce a `EMAIL_ALREADY_EXISTS`
- [x] 5.2 Implementar la interfaz `PasswordHasher` con argon2; verificar con tests unitarios que el hash no contiene la contraseña y que verifica correctamente
- [x] 5.3 Implementar `POST /auth/register` (schemas estrictos, controller, service, routes) que crea siempre `USER`; verificar con tests de integración `201` con rol `USER`, `409` con email repetido (incluidas otras mayúsculas) y `400` por contraseña corta, email inválido o campo `role` enviado
- [x] 5.4 Verificar que la respuesta del registro no incluye contraseña ni hash y que los logs no los registran

## 6. Login y autorización

- [x] 6.1 Implementar la interfaz `TokenService` con jsonwebtoken (claims `sub` y `role`, expiración configurable); verificar con tests unitarios que firma, verifica y rechaza tokens alterados o vencidos
- [x] 6.2 Implementar `POST /auth/login`; verificar con tests de integración `200` con `accessToken`, `tokenType` y `expiresIn`, y `401` `INVALID_CREDENTIALS` con el mismo mensaje para contraseña incorrecta y email inexistente
- [x] 6.3 Implementar el middleware `authenticate` que deja `req.auth = { userId, role }`; verificar con tests `401` `UNAUTHORIZED` sin token, con token expirado y con firma alterada
- [x] 6.4 Implementar el middleware `requireRole`; verificar con tests de integración sobre una ruta de prueba que USER recibe `403` `FORBIDDEN` y ADMIN pasa
- [x] 6.5 Verificar que el id usado por los endpoints protegidos sale del token y no del cuerpo de la solicitud

## 7. Administración de usuarios

- [x] 7.1 Implementar `AdminSeeder` ejecutado en el arranque tras las migraciones (crea el `ADMIN` solo si no existe ninguno y las variables están definidas; si faltan, registra un aviso y continúa); verificar con tests de integración el primer arranque con variables, el reinicio sin cambios aunque las variables cambien y el arranque sin variables
- [x] 7.2 Verificar que el `ADMIN` del seed puede iniciar sesión con `SEED_ADMIN_PASSWORD`, que se guarda solo el hash y que la contraseña no aparece en los logs
- [x] 7.3 Implementar `POST /users` (`authenticate` + `requireRole('ADMIN')`, `role` obligatorio) reutilizando la creación de `UserService`; verificar con tests de integración `201` al crear `USER` y `ADMIN`, `401` sin token, `403` con un `USER`, `400` con rol ausente o inválido y `409` con email repetido

## 8. Arquitectura y cierre

- [x] 8.1 Configurar dependency-cruiser con las reglas (controller no importa repository, service no importa `express`, un módulo no importa el repository de otro, sin ciclos) y el test en `tests/architecture`; verificar que pasa y que falla al introducir un import prohibido de prueba
- [x] 8.2 Escribir el test de extremo a extremo (seed del ADMIN, login, creación de otro usuario por el ADMIN, registro público y ruta protegida) con Testcontainers; verificar que `pnpm test` pasa completo
- [x] 8.3 Escribir el `README` en español con cómo levantar el proyecto, las variables de entorno (incluidas las del seed del ADMIN), los scripts y los endpoints de este cambio; verificar siguiendo el README desde cero hasta un login exitoso con `curl`
