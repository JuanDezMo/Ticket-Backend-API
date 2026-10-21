## Purpose

Permite a un usuario autenticarse y obtener un JWT, y ofrece la autenticación y la autorización por rol que protegen los endpoints de los demás módulos.

## ADDED Requirements

### Requirement: Login
El sistema SHALL exponer `POST /auth/login` sin autenticación, que recibe `email` y `password` y responde `200` con `{ accessToken, tokenType: "Bearer", expiresIn }`.

#### Scenario: Credenciales correctas
- **WHEN** se envían el email y la contraseña de un usuario existente
- **THEN** el sistema responde `200` con un `accessToken`, `tokenType` `Bearer` y `expiresIn` en segundos

### Requirement: Contenido del token
El `accessToken` SHALL ser un JWT firmado que incluye el identificador del usuario como `sub`, su `role` y una fecha de expiración (por defecto 3600 segundos, configurable).

#### Scenario: Token de un ADMIN
- **WHEN** un usuario con rol `ADMIN` inicia sesión
- **THEN** el token decodificado contiene `sub` con su id y `role` `ADMIN`

### Requirement: Credenciales inválidas
El sistema MUST responder `401` con `code` `INVALID_CREDENTIALS` y el mismo mensaje cuando el email no existe o la contraseña es incorrecta, sin revelar cuál de los dos falló.

#### Scenario: Contraseña incorrecta
- **WHEN** se envía un email existente con una contraseña errónea
- **THEN** el sistema responde `401` con `code` `INVALID_CREDENTIALS`

#### Scenario: Email inexistente
- **WHEN** se envía un email que no está registrado
- **THEN** el sistema responde `401` con el mismo `code` y el mismo mensaje

### Requirement: Autenticación de endpoints protegidos
Todo endpoint protegido SHALL exigir `Authorization: Bearer <accessToken>`; si falta, es inválido, está mal firmado o expiró, MUST responder `401` con `code` `UNAUTHORIZED`. Son públicos únicamente el registro, el login, el listado de eventos y la salud.

#### Scenario: Sin token
- **WHEN** se llama a un endpoint protegido sin el header `Authorization`
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

#### Scenario: Token expirado
- **WHEN** el token ya venció
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

#### Scenario: Token con firma alterada
- **WHEN** el token fue modificado
- **THEN** el sistema responde `401` con `code` `UNAUTHORIZED`

### Requirement: Autorización por rol
Un endpoint restringido a un rol SHALL responder `403` con `code` `FORBIDDEN` cuando el usuario autenticado tiene otro rol.

#### Scenario: USER en un endpoint de ADMIN
- **WHEN** un usuario con rol `USER` llama a un endpoint exclusivo de `ADMIN`
- **THEN** el sistema responde `403` con `code` `FORBIDDEN`

#### Scenario: ADMIN en un endpoint de ADMIN
- **WHEN** un usuario con rol `ADMIN` llama a ese endpoint
- **THEN** el sistema continúa con la operación

### Requirement: Identidad disponible para los módulos
El sistema SHALL poner a disposición de los controllers el id y el rol del usuario autenticado, tomados del token y no del cuerpo de la solicitud.

#### Scenario: Id tomado del token
- **WHEN** un endpoint protegido recibe un cuerpo con otro id de usuario
- **THEN** el sistema usa el id del token y no el del cuerpo
