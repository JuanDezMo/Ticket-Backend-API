# reservation-expiry Specification

## Purpose

Garantiza que una reserva retenga el seat solo durante un tiempo limitado y que las reservas vencidas liberen el seat, sin depender de que alguien lo consulte.

## Requirements

### Requirement: Vencimiento de la reserva
Toda reserva SHALL guardar `expiresAt`, igual al momento de creación más el TTL configurado (por defecto 10 minutos, `RESERVATION_TTL_MINUTES`), calculado con la hora de la base de datos.

#### Scenario: TTL por defecto
- **WHEN** se crea una reserva sin configurar el TTL
- **THEN** `expiresAt` es 10 minutos posterior a `createdAt`

#### Scenario: TTL configurado
- **WHEN** el TTL configurado es 3 minutos
- **THEN** `expiresAt` es 3 minutos posterior a `createdAt`

### Requirement: Liberación de reservas vencidas
El sistema SHALL tratar como vencida toda reserva `ACTIVE` cuyo `expiresAt` sea menor o igual al momento actual: la reserva pasa a `EXPIRED` y su seat vuelve a `AVAILABLE`, en una sola operación atómica. Solo MUST liberar seats que sigan `RESERVED`.

#### Scenario: Reserva vencida
- **WHEN** una reserva `ACTIVE` tiene `expiresAt` en el pasado y se ejecuta la liberación
- **THEN** la reserva queda `EXPIRED` y su seat `AVAILABLE`

#### Scenario: Reserva vigente
- **WHEN** una reserva `ACTIVE` aún no ha vencido
- **THEN** la liberación no la modifica ni modifica su seat

#### Scenario: Seat ya vendido
- **WHEN** la reserva está `CONFIRMED` o su seat está `SOLD`
- **THEN** la liberación no cambia el seat

### Requirement: Liberación al reservar
Antes de reservar un seat, el sistema SHALL liberar las reservas vencidas del evento, de modo que un seat cuya reserva venció pueda reservarse de inmediato.

#### Scenario: Reservar un seat con reserva vencida
- **WHEN** un seat tiene una reserva `ACTIVE` ya vencida y otro USER lo reserva
- **THEN** la reserva anterior pasa a `EXPIRED` y el sistema responde `201` con la reserva nueva

### Requirement: Liberación periódica
El sistema SHALL ejecutar la liberación de reservas vencidas de todos los eventos de forma periódica (cada 60 segundos por defecto, configurable con `RESERVATION_EXPIRY_INTERVAL_SECONDS`) desde el arranque, y detenerla al apagarse. Un fallo en una ejecución MUST NOT detener las siguientes.

#### Scenario: Evento que nadie consulta
- **WHEN** vence una reserva de un evento que nadie consulta y pasa un intervalo del job
- **THEN** la reserva queda `EXPIRED` y el seat `AVAILABLE`

#### Scenario: Fallo de una ejecución
- **WHEN** una ejecución del job falla por un error de base de datos
- **THEN** el error se registra en el log y la siguiente ejecución se realiza igual

#### Scenario: Varias instancias
- **WHEN** dos instancias ejecutan la liberación a la vez
- **THEN** el resultado es el mismo que con una sola, sin errores ni duplicados
