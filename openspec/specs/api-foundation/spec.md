# api-foundation Specification

## Purpose

Define el comportamiento común de la API que comparten todos los módulos: formato de errores, validación de entrada, rutas inexistentes, endpoint de salud y arranque con configuración obligatoria.

## Requirements

### Requirement: Formato de error
El sistema SHALL responder todo error con un cuerpo `{ "code": "<ErrorCode>", "message": "<texto en inglés>" }` y el código HTTP que corresponda al caso.

#### Scenario: Error controlado
- **WHEN** una operación falla por una regla de negocio
- **THEN** la respuesta incluye `code` y `message` en inglés, y ningún otro dato interno

### Requirement: Errores no controlados
El sistema MUST responder `500` con `code` `INTERNAL_ERROR` y un mensaje genérico ante cualquier error inesperado, sin exponer trazas, consultas ni detalles internos, y SHALL registrar el detalle en el log.

#### Scenario: Fallo inesperado
- **WHEN** ocurre un error no previsto durante una solicitud
- **THEN** el sistema responde `500` con `code` `INTERNAL_ERROR`, y el detalle del error solo aparece en el log

### Requirement: Validación de entrada
El sistema SHALL validar el cuerpo, los parámetros y la consulta de cada solicitud antes de ejecutar la operación y MUST responder `400` con `code` `VALIDATION_ERROR` y un mensaje que indique el campo inválido.

#### Scenario: Cuerpo inválido
- **WHEN** llega una solicitud con un campo obligatorio ausente o con formato incorrecto
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y no ejecuta la operación

#### Scenario: Cuerpo que no es JSON
- **WHEN** el cuerpo de la solicitud no es JSON válido
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

### Requirement: Ruta inexistente
El sistema SHALL responder `404` con `code` `NOT_FOUND` cuando la ruta no existe.

#### Scenario: Ruta desconocida
- **WHEN** se solicita una ruta que la API no expone
- **THEN** el sistema responde `404` con `code` `NOT_FOUND`

### Requirement: Endpoint de salud
El sistema SHALL exponer `GET /health` sin autenticación, que responde `200` con `{ "status": "UP" }` cuando la base de datos es alcanzable y `503` con `{ "status": "DOWN" }` cuando no lo es.

#### Scenario: Servicio sano
- **WHEN** se consulta `/health` con la base de datos disponible
- **THEN** el sistema responde `200` con `status` `UP`

#### Scenario: Base de datos caída
- **WHEN** se consulta `/health` y la base de datos no responde
- **THEN** el sistema responde `503` con `status` `DOWN`

### Requirement: Configuración obligatoria al arrancar
El sistema MUST rechazar el arranque, indicando qué variable falta o es inválida, si no están definidas `DATABASE_URL` y `JWT_SECRET`.

#### Scenario: Falta una variable obligatoria
- **WHEN** el proceso inicia sin `JWT_SECRET`
- **THEN** termina con un mensaje que nombra la variable faltante y no atiende solicitudes
