## 1. Configuración y datos

- [x] 1.1 Agregar `RESERVATION_TTL_MINUTES` (10 por defecto) y `RESERVATION_EXPIRY_INTERVAL_SECONDS` (60 por defecto) a `config/env.ts` y `.env.example`; verificar con tests unitarios los valores por defecto, un valor personalizado y el rechazo de 0 o no numéricos
- [x] 1.2 Crear la migración de `reservations` (FKs, `CHECK` de `status`, índices parciales `(expires_at) WHERE status='ACTIVE'` y `(event_id) WHERE status='ACTIVE'`, y único parcial `(seat_id) WHERE status='ACTIVE'`); verificar en PostgreSQL de Testcontainers que una segunda reserva `ACTIVE` del mismo seat es rechazada, pero una `EXPIRED` no
- [x] 1.3 Regenerar `db/types.ts` con kysely-codegen; verificar que `pnpm build` compila con los tipos nuevos
- [x] 1.4 Agregar `SEAT_NOT_FOUND`, `SEAT_NOT_AVAILABLE` y `EVENT_NOT_ACTIVE` a `ErrorCode`; verificar con test unitario sus códigos HTTP y mensajes en inglés

## 2. Seats

- [x] 2.1 Agregar a `SeatService` y `SeatRepository` `findByEventAndLabel(eventId, row, number)` y `markReserved(seatId, executor)` (UPDATE condicional a `AVAILABLE` que devuelve si afectó una fila); verificar con tests de integración que se encuentra el seat solo dentro de su evento, que uno `AVAILABLE` pasa a `RESERVED` y que uno `RESERVED`, `SOLD` o `BLOCKED` no cambia
- [x] 2.2 Implementar la función pura `parseSeatLabel` (`C7` -> fila `C`, número 7; acepta minúscula; rechaza `7C`, `C0`, `C11`, vacío y letras fuera de `A`-`Z`); verificar con tests unitarios parametrizados de formatos válidos e inválidos

## 3. Reservas

- [x] 3.1 Definir los tipos y enums de reserva (`ReservationStatus`) y el schema estricto `{ eventId: uuid, seat }` con la etiqueta normalizada a mayúscula; verificar con tests unitarios eventId o seat ausentes, eventId inválido, etiqueta inválida, `c7` aceptada como `C7` y campos extra (incluido `amount`)
- [x] 3.2 Implementar `ReservationRepository.releaseExpired(eventId?, executor)` con la sentencia CTE atómica; verificar con tests de integración: vencida pasa a `EXPIRED` y su seat a `AVAILABLE`, vigente no cambia, seat `SOLD` no cambia, filtro por evento, y dos ejecuciones simultáneas sin error
- [x] 3.3 Implementar `ReservationRepository.create` calculando `expires_at` con la hora de la BD (`now()` + TTL); verificar con tests de integración que `expiresAt - createdAt` es el TTL configurado (10 y 3 minutos)
- [x] 3.4 Implementar `ReservationService.create` con la transacción y el orden de validaciones (seat, evento, liberación, marcar seat, insertar reserva), traduciendo la violación del índice único a `SEAT_NOT_AVAILABLE`; verificar con tests unitarios el orden (evento cancelado antes que seat no disponible) y con tests de integración el rollback: si falla la inserción, el seat vuelve a `AVAILABLE`
- [x] 3.5 Implementar `POST /reservations` (controller, routes, `authenticate` + `requireRole('USER')`) con el cuerpo `{ eventId, seat }` y la respuesta `{ id, eventId, seatId, seat, status, amount, expiresAt, createdAt }`; verificar con tests de integración `201` con `amount` igual al precio del evento y seat `RESERVED`, `403` como ADMIN, `401` sin token, `400` por eventId o seat ausentes, etiqueta inválida o campo `amount`, `404` `EVENT_NOT_FOUND`, `404` `SEAT_NOT_FOUND` (etiqueta fuera de la capacidad y etiqueta de otro evento), `409` `SEAT_NOT_AVAILABLE` (reservado, vendido y bloqueado) y `409` `EVENT_NOT_ACTIVE` (evento cancelado y evento ya iniciado)
- [x] 3.6 Verificar la concurrencia: varias solicitudes simultáneas de distintos USER sobre el mismo seat dan exactamente un `201`, el resto `409`, y una sola reserva `ACTIVE`
- [x] 3.7 Verificar la liberación al reservar: un seat con una reserva `ACTIVE` vencida puede reservarlo otro USER de inmediato y la reserva anterior queda `EXPIRED`

## 4. Liberación periódica y listado de seats

- [x] 4.1 Hacer que `GET /events/:id/seats` llame a `ReservationService.releaseExpired(eventId)` antes de listar; verificar con tests de integración que un seat con reserva vencida aparece `AVAILABLE` (y su reserva `EXPIRED`) y que uno con reserva vigente aparece `RESERVED` y no figura entre los `AVAILABLE`
- [x] 4.2 Implementar `ReservationExpiryJob` (intervalo inyectado, sin solapamiento, errores registrados sin detener el job, `unref`); verificar con tests de integración con un intervalo de 1 s que libera una reserva vencida de un evento que nadie consulta, y con un test unitario que un fallo no detiene las siguientes ejecuciones
- [x] 4.3 Arrancar el job desde `server.ts` tras las migraciones y detenerlo en el apagado; verificar con `docker compose up` que el log registra el inicio del job y que el proceso termina limpio con `docker compose stop`

## 5. Cierre

- [x] 5.1 Registrar `reservations` en `container.ts` y `app.ts`; verificar que `pnpm arch` pasa (el controller no importa el repository, ningún módulo importa el repository de otro, sin ciclos)
- [x] 5.2 Escribir el test de extremo a extremo (ADMIN crea un evento, USER reserva el seat A1, otro USER recibe `409`, se fuerza el vencimiento, el seat aparece `AVAILABLE` y el otro USER lo reserva); verificar que `pnpm test` pasa completo
- [x] 5.3 Actualizar el `README` en español con `POST /reservations`, las variables nuevas y un ejemplo con `curl`; verificar siguiendo el README contra `docker compose`
