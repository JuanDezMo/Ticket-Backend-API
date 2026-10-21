## 1. Datos

- [x] 1.1 Crear la migración de `events` (campos, `CHECK` de `type`, `status` y `capacity` entre 1 y 260, e índices `(start_date, id)`, `(status)` y `(type)`); verificar en PostgreSQL de Testcontainers que la migración se aplica y que un `capacity` fuera de rango o un `type` inválido es rechazado por la BD
- [x] 1.2 Crear la migración de `seats` con `UNIQUE (event_id, row, number)`, `CHECK` de `status` e índice `(event_id, status)`; verificar que un seat duplicado para el mismo evento es rechazado
- [x] 1.3 Regenerar `db/types.ts` con kysely-codegen; verificar que `pnpm build` compila con los tipos nuevos

## 2. Generación de seats

- [x] 2.1 Definir en `seats` las constantes (`SEATS_PER_ROW`, `MAX_CAPACITY`) y el enum `SeatStatus`; verificar que `service` y `controller` no contienen literales de negocio
- [x] 2.2 Implementar `generateSeatLayout(capacity)`; verificar con tests unitarios las capacidades 1, 10, 20, 25, 100 y 260 (primer y último seat, cantidad exacta y última fila incompleta)
- [x] 2.3 Implementar `SeatRepository` (inserción múltiple y consulta por evento y estado, ordenada por fila y número); verificar con tests de integración la inserción de 260 filas y el orden de la consulta

## 3. Eventos

- [x] 3.1 Definir `EventType`, `EventStatus` y los schemas zod de creación (campos obligatorios, `type`, `price > 0` con 2 decimales, `capacity` 1 a 260, fechas ISO, `startDate > now` y `endDate > startDate`); verificar con tests unitarios cada regla de validación
- [x] 3.2 Implementar `paginationSchema` (`page` mínimo 1 por defecto 1; `pageSize` de 1 a 20 por defecto 20, sin recortar valores mayores) y el helper `paginate` en `shared/utils`; verificar con tests unitarios `pageSize` 20 válido, 21 y 0 inválidos, y el cálculo de `meta` para 0, 20, 21 y 45 registros
- [x] 3.3 Implementar el schema de filtros de eventos (`status`, `type`, `startFrom`, `startTo`, `search` con `startFrom <= startTo`); verificar con tests unitarios cada valor válido e inválido
- [x] 3.4 Implementar `EventRepository` (crear y listar con `where` dinámico por filtros, `limit`/`offset` y `count`, ordenado por `start_date` e `id`); verificar con tests de integración que guarda y lista eventos de todos los estados, que cada filtro y sus combinaciones funcionan y que `total` refleja solo lo filtrado
- [x] 3.5 Implementar `EventService.create` con una transacción que inserta el evento y genera los seats mediante `SeatService`; verificar con tests de integración que se crean `capacity` seats `AVAILABLE` y que un fallo en la inserción de seats no deja el evento ni seats huérfanos
- [x] 3.6 Implementar `POST /events` con `authenticate` y `requireRole('ADMIN')`; verificar con tests de integración `201` como ADMIN, `403` como USER, `401` sin token y `400` por tipo, precio, capacidad o fechas inválidas
- [x] 3.7 Implementar `GET /events` público con paginación y filtros, y la respuesta `{ data, meta }`; verificar con tests `200` sin token, el evento `CANCELLED` visible, `data` vacío con `total` 0 sin eventos, página fuera de rango, orden estable recorriendo todas las páginas y `400` con `pageSize` 21, `pageSize` 0, `page` 0, `type` inválido o `startFrom` posterior a `startTo`

## 4. Seats de un evento

- [x] 4.1 Agregar `EVENT_NOT_FOUND` a `ErrorCode` e implementar `EventService.getById`; verificar con test unitario que un id inexistente lanza el error
- [x] 4.2 Implementar `GET /events/:id/seats` con `authenticate`, filtro opcional `status` y respuesta `{ eventId, data }` con `label`; verificar con tests `200` con 20 seats ordenados de `A1` a `B10`, filtro `AVAILABLE`, `400` con `status` inválido, `404` `EVENT_NOT_FOUND` y `401` sin token
- [x] 4.3 Verificar que un evento `CANCELLED` (con seats `BLOCKED` preparados en la BD de prueba) devuelve lista vacía con `status=AVAILABLE`

## 5. Cierre

- [x] 5.1 Verificar que `dependency-cruiser` pasa con los módulos `events` y `seats` (el controller no importa el repository, ningún módulo importa el repository de otro, sin ciclos)
- [x] 5.2 Escribir el test de extremo a extremo (login como ADMIN, crear evento de 25 puestos, listar eventos sin token, listar seats disponibles como USER y comprobar `A1..C5`); verificar que `pnpm test` pasa completo
- [x] 5.3 Actualizar el `README` en español con los endpoints nuevos (`POST /events`, `GET /events`, `GET /events/:id/seats`) y un ejemplo con `curl`; verificar siguiendo el README desde cero
