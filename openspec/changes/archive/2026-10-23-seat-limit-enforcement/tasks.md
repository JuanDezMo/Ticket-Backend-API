## 1. Configuración y errores

- [x] 1.1 Agregar `MAX_ACTIVE_HOLDS_PER_USER` a `src/config/env.ts` (entero ≥ 1, por defecto 8), a `docker-compose.yml` y `.env.example`, y los códigos `SEAT_LIMIT_REACHED` y `HOLD_LIMIT_REACHED` (`409`) a `src/shared/errors/error-code.ts`. Verificar con pruebas de configuración con valores límite: sin variable da 8, **1** (mínimo) y 8 se aceptan, **0**, negativo y texto fallan con `ConfigError`; y que cada código responde `409` con su mensaje

## 2. Base de datos

- [x] 2.1 Agregar a `src/db/migrations/004-create-reservations.ts` los dos índices parciales (`reservations_user_event_hold_idx` y `reservations_user_active_idx`), recrear el volumen y regenerar `src/db/types.ts` si cambia. Verificar con una prueba de integración que ambos existen en `pg_indexes` con su condición parcial

## 3. Seats

- [x] 3.1 Agregar al repositorio y al servicio de seats: buscar varios seats por posiciones en una consulta, `lockByIds` (`ORDER BY id FOR UPDATE`) y marcar varios como `RESERVED` en un solo `UPDATE`. Verificar con pruebas de integración: devuelve solo los existentes del evento indicado (no los de otro), el bloqueo toma las filas en orden ascendente y marcar varios deja todos `RESERVED`

## 4. Repositorio de reservas

- [x] 4.1 Agregar a `reservation.repository.ts`: `createMany` (un solo `INSERT`, mismo `created_at` y `expires_at`), `countHoldsForEvent`, `countActiveHolds` y `lockHoldsOf` (bloqueo de asesoría por usuario). Verificar con pruebas de integración: el lote comparte `expires_at`; el conteo cuenta `ACTIVE` vigente y `CONFIRMED` y **no** cuenta `EXPIRED`, `CANCELLED`, `CANCELLED_BY_USER` ni una `ACTIVE` ya vencida; el tope global no cuenta `CONFIRMED`; con 0, 1 y 8 reservas devuelve 0, 1 y 8; y dos transacciones del mismo usuario se serializan mientras las de usuarios distintos no

- [x] 4.2 Reescribir `releaseExpired` en `reservation.repository.ts`: seleccionar las reservas vencidas con `ORDER BY id FOR UPDATE SKIP LOCKED`, bloquear sus seats por id ascendente y liberarlos en la misma sentencia atómica. Verificar con una prueba de integración: dos transacciones que liberan en paralelo las mismas vencidas, repetida 20 veces, terminan sin interbloqueo, cada seat queda `AVAILABLE` exactamente una vez y no queda ninguna reserva vencida en `ACTIVE`; y un lote que reserva un seat que otra transacción está liberando lo obtiene sin recibir `SEAT_NOT_AVAILABLE`

## 5. Contrato HTTP

- [x] 5.1 Cambiar `createReservationSchema` a `{ eventId, seats }` (1 a `MAX_SEATS_PER_USER`, normalizadas, sin repetidas, `.strict()`) y el controlador para responder `201` con `{ reservations: [...] }`. Verificar con pruebas del esquema con valores límite: **1 y 8 seats** válidos, **0 y 9** inválidos, repetidas (`C5` y `c5`), etiqueta inválida, campo antiguo `seat` y campo `amount`

## 6. Servicio de reservas

- [x] 6.1 Reescribir `ReservationService.create` con el flujo de la decisión 2 y el lote atómico (todo o nada, `SEAT_NOT_FOUND` si falta cualquiera, `SEAT_NOT_AVAILABLE` con las etiquetas afectadas, vencimiento común), sin los límites todavía, e inyectar la configuración en `container.ts`. Verificar con pruebas de integración: un seat, tres seats, un seat ocupado en el medio del lote deja los demás `AVAILABLE`, una etiqueta inexistente en un lote no reserva ninguno, y un fallo al insertar revierte todos
- [x] 6.2 Aplicar el límite por evento (`SEAT_LIMIT_REACHED` con el N en el mensaje). Verificar con pruebas con valores límite: evento con límite **1** (la primera reserva pasa y la segunda da `409`), evento con límite **8** (un lote de 8 pasa y una más da `409`), límite 4 con 3 activas y 1 pedida (pasa) y con 3 activas y 2 pedidas (falla), un ticket comprado cuenta, y lo vencido o cancelado libera cupo; y que el límite es por evento (otro evento no se afecta)
- [x] 6.3 Aplicar el tope global (`HOLD_LIMIT_REACHED`) y el orden de validaciones. Verificar con pruebas con valores límite: con el tope en 8, 8 reservas activas repartidas en dos eventos pasan y la novena da `409`; con el tope en **1** la segunda falla; lo comprado no cuenta; `SEAT_LIMIT_REACHED` se responde antes que `SEAT_NOT_AVAILABLE` y `HOLD_LIMIT_REACHED` después del primero

## 7. Concurrencia

- [x] 7.1 Pruebas de concurrencia, repetidas varias veces para detectar condiciones de carrera: dos solicitudes simultáneas del mismo usuario con límite 2 y una ya reservada (una `201` y una `409`); N solicitudes en paralelo en el límite exacto (nunca se supera); dos lotes que se cruzan (`C5,C6` y `C6,C5`) sin interbloqueo; el mismo seat pedido por varios usuarios (una sola `201`); y todo lo anterior con reservas vencidas presentes. Verificar con `pnpm test`, ejecutándolas al menos 20 veces seguidas sin fallos Verificado el 2026-10-23 con una batería de 20 corridas de 7 archivos de concurrencia (18 pasaron; 2 fallaron en `purchase-cancellation-race` por `PAYMENT_IN_PROGRESS` en lugar de `EVENT_CANCELLED`), la corrección del reclamo (`claimOrExplain`), dos pruebas deterministas nuevas y 6 corridas posteriores sin fallos (1 de la batería y 5 de `purchase-cancellation-race`). No se repitieron las 20 completas tras la corrección.
  - **Pendiente al archivar:** las pruebas existen (`tests/integration/reservation-concurrency.test.ts`) y pasan en una corrida, pero en 2 de 20 corridas repetidas falló la prueba de seats vencidos con una respuesta distinta de `201` y `409`. La causa no se investigó por decisión del usuario; si resulta un defecto real, abrir un change aparte.

## 8. Consumidores internos

- [x] 8.1 Actualizar `tests/helpers/purchase.ts` (`reserveSeat` envía `seats` y lee `body.reservations[0]`), las pruebas que reservan por HTTP o por servicio (9 sitios) y `scripts/verify-gateway.sh`. Verificar con `pnpm test`: la suite completa existente sigue pasando

## 9. Documentación y cierre

- [x] 9.1 Documentar en `docs/business-rules.md` las reglas de límite por evento, tope global, lote y qué cuenta, en `docs/architecture.md` §11 el nuevo cuerpo y respuesta de `POST /reservations` y los dos códigos, el `README`, `docs/ci-cd.md` (variable y volumen) y los índices en `docs/data-model.md`. Verificar leyendo los archivos
- [x] 9.2 Prueba contra la API real: reservar 1 seat, un lote hasta el máximo del evento y uno más (`SEAT_LIMIT_REACHED`), un lote con un seat ocupado (nada reservado), el tope global entre dos eventos y la compra de una reserva del lote. Verificar las respuestas y `pnpm lint`, `pnpm arch` y `pnpm test`
