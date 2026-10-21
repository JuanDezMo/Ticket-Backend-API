## 1. Implementación

- [x] 1.1 En `src/modules/reservations/reservation.service.ts`, en `getForOwner`, reemplazar `throw new AppError('INTERNAL_ERROR')` por `throw new Error(\`Seat ${reservation.seatId} not found for reservation ${reservation.id}\`)`, con un comentario en español que explique que es un error inesperado y que el `errorHandler` lo registra en el log. Verificar con `pnpm build`

## 2. Pruebas

- [x] 2.1 En `tests/unit/reservation-service.test.ts`, cambiar el caso del seat inexistente: rechaza con `toThrow('Seat seat-1 not found for reservation res-1')`, el error no es instancia de `AppError` y no se escribe en la BD. Verificar con `pnpm test tests/unit/reservation-service.test.ts`

## 3. Cierre

- [x] 3.1 Correr `pnpm lint`, `pnpm build`, `pnpm arch` y `pnpm test` completos. Verificar que todo pasa
