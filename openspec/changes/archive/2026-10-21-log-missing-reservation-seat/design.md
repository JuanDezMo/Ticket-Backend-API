## Context

El `errorHandler` (`src/shared/middleware/error-handler.ts`) tiene dos caminos:
- `AppError`: responde `status`, `code` y `message` **sin registrar en el log**. Está pensado para errores de negocio esperados.
- Cualquier otro error: lo registra con `logger.error({ err })` y responde `500 INTERNAL_ERROR` con el mensaje genérico. Está pensado para errores inesperados.

El design de `reservation-detail` (decisión 2) eligió `AppError('INTERNAL_ERROR')` para el seat inexistente, así que el caso cae en el primer camino y no queda en el log.

## Goals / Non-Goals

**Goals:**
- Que el seat inexistente quede en el log con datos suficientes para investigarlo, sin cambiar la respuesta HTTP.

**Non-Goals:**
- Cambiar el `errorHandler` ni el manejo de los demás `AppError`.

## Decisions

### 1. Lanzar un `Error` normal
`throw new Error(\`Seat ${reservation.seatId} not found for reservation ${reservation.id}\`)`.
- Un seat que falta pese a la clave foránea es un error inesperado, no de negocio. Le corresponde el camino de errores inesperados del `errorHandler`, que ya registra el detalle y lo oculta al cliente.
- El mensaje incluye ids, que no son datos sensibles, y no se expone en la respuesta.
- *Alternativa C:* inyectar `Logger` en `ReservationService`, registrar el error y lanzar el `AppError`, como en `payment.service.ts`. Se descarta porque obliga a tocar `container.ts` y el `setup()` de los tests para un caso casi imposible.
- *Alternativa D:* registrar en el `errorHandler` todo `AppError` con `status >= 500`. Se descarta por ahora porque cambia un componente compartido y registraría dos veces el caso de pagos.

## Risks / Trade-offs

- [El unit test ya no puede comparar `code`] → compara el mensaje con `rejects.toThrow(...)` y verifica que no es un `AppError`.
- [No hay prueba de integración] → la clave foránea impide crear el caso en PostgreSQL real; el registro de errores inesperados ya está cubierto por las pruebas de `api-foundation`.
