## 1. Base de datos

- [x] 1.1 Recrear el volumen local (`docker compose down -v`), editar `src/db/migrations/002-create-events.ts` con `max_seats_per_user` (`NOT NULL`, sin valor por defecto, `CHECK BETWEEN 1 AND 8` y `CHECK <= capacity`) y regenerar `src/db/types.ts` con `pnpm db:codegen`. Verificar con una prueba de integración de la migración con valores límite: **aceptar 1 (mínimo) y 8 (máximo, con capacidad de al menos 8)**, y rechazar 0, 9, nulo y un valor mayor que `capacity` (por ejemplo 5 con capacidad 4), y que el diff de `types.ts` solo agrega la columna

## 2. API de eventos

- [x] 2.1 Agregar `MAX_SEATS_PER_USER = 8` y `maxSeatsPerUser` a `NewEvent`, `Event` y `PublicEvent` en `event.types.ts`, y mapear la columna en `event.repository.ts` y `toPublicEvent`. Verificar con `pnpm build` y que el repositorio devuelve el valor guardado
- [x] 2.2 Agregar `maxSeatsPerUser` a `createEventSchema` con mensajes distintos para faltante (`maxSeatsPerUser: is required`) y para valor inválido, y la regla `<= capacity` en el `superRefine`. Verificar con pruebas unitarias del esquema con valores límite: **1 (mínimo) y 8 (máximo)** válidos, **0 y 9** inválidos, y además falta, decimal, texto, mayor que la capacidad, igual a la capacidad (4 con capacidad 4) y 1 con capacidad 1
- [x] 2.3 Pruebas de integración de las rutas: `POST /events` devuelve `201` con `maxSeatsPerUser` tanto con **1 (mínimo)** como con **8 (máximo)**, y `400` con 0 y con 9; sin el campo, `400` con el mensaje de obligatorio y sin crear el evento; `GET /events` y `GET /events/:id` lo devuelven, también para un evento cancelado; un USER sigue recibiendo `403`. Verificar con `pnpm test`

## 3. Consumidores internos

- [x] 3.1 Actualizar `tests/helpers/events.ts` (`eventBody` con `maxSeatsPerUser` y `insertEvent` con `Math.min(4, capacity)` por defecto) y las pruebas que arman cuerpos propios. Verificar con `pnpm test`: las 30 o más pruebas de integración existentes siguen pasando
- [x] 3.2 Enviar `maxSeatsPerUser` en el `POST /events` de `scripts/verify-gateway.sh`. Verificar leyendo el script y, si hay entorno, ejecutándolo hasta la creación del evento

## 4. Documentación y cierre

- [x] 4.1 Documentar el campo y RN-EVT-8 en `docs/business-rules.md`, los cuerpos en `docs/architecture.md` §11, el `curl` del `README` y el paso de recrear el volumen en `docs/ci-cd.md`. Verificar leyendo los cuatro archivos
- [x] 4.2 Crear un evento real con la API levantada (con y sin el campo, con **1**, con **8**, con 0, con 9 y con un valor mayor que la capacidad) y consultar su detalle. Verificar con las respuestas esperadas y con `pnpm lint`, `pnpm arch` y `pnpm test`
