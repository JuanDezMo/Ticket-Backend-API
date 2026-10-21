## Purpose

Permite que solo un administrador cree otros usuarios (`USER` o `ADMIN`) y garantiza que exista un primer administrador mediante un seed al arrancar.

## ADDED Requirements

### Requirement: Creación de usuarios por un ADMIN
El sistema SHALL exponer `POST /users`, restringido al rol `ADMIN`, que recibe `email`, `password` y `role` obligatorio (`USER` o `ADMIN`) y responde `201` con `{ id, email, role, createdAt }`.

#### Scenario: ADMIN crea otro ADMIN
- **WHEN** un `ADMIN` autenticado envía datos válidos con `role` `ADMIN`
- **THEN** el sistema responde `201` con `role` `ADMIN`

#### Scenario: ADMIN crea un USER
- **WHEN** un `ADMIN` autenticado envía datos válidos con `role` `USER`
- **THEN** el sistema responde `201` con `role` `USER`

### Requirement: Acceso restringido
El sistema MUST responder `401` con `code` `UNAUTHORIZED` si no hay token válido y `403` con `code` `FORBIDDEN` si el usuario autenticado no es `ADMIN`.

#### Scenario: Sin token
- **WHEN** se llama a `POST /users` sin `Authorization`
- **THEN** el sistema responde `401`

#### Scenario: USER intenta crear usuarios
- **WHEN** un usuario con rol `USER` llama a `POST /users`
- **THEN** el sistema responde `403` con `code` `FORBIDDEN` y no crea ningún usuario

### Requirement: Validación al crear usuarios
El sistema SHALL exigir email con formato válido, contraseña de al menos 8 caracteres y `role` dentro de `USER` o `ADMIN`, y MUST responder `409` con `code` `EMAIL_ALREADY_EXISTS` si el email ya existe, sin distinguir mayúsculas de minúsculas.

#### Scenario: Rol ausente o inválido
- **WHEN** falta `role` o su valor es `SUPERUSER`
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Email repetido
- **WHEN** un `ADMIN` crea un usuario con un email existente
- **THEN** el sistema responde `409` con `code` `EMAIL_ALREADY_EXISTS`

### Requirement: Seed del primer ADMIN
Al arrancar, el sistema SHALL crear un usuario `ADMIN` con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` si no existe ningún `ADMIN` y ambas variables están definidas. El sistema MUST NOT crear ni modificar usuarios si ya existe un `ADMIN`. Si no existe un `ADMIN` y faltan las variables, SHALL continuar el arranque y registrar un aviso en el log.

#### Scenario: Primer arranque con variables
- **WHEN** el sistema inicia sin ningún `ADMIN` y con ambas variables definidas
- **THEN** existe un usuario `ADMIN` con ese email, y puede iniciar sesión con esa contraseña

#### Scenario: Reinicio
- **WHEN** el sistema inicia y ya existe un `ADMIN`
- **THEN** no se crea ni se modifica ningún usuario, aunque las variables hayan cambiado

#### Scenario: Primer arranque sin variables
- **WHEN** el sistema inicia sin ningún `ADMIN` y sin las variables
- **THEN** el arranque continúa y el log registra un aviso

### Requirement: Protección de la contraseña del seed
El sistema MUST almacenar la contraseña del seed solo como hash y MUST NOT registrarla en logs.

#### Scenario: Datos persistidos del seed
- **WHEN** se crea el `ADMIN` del seed
- **THEN** el registro guarda un hash y no la contraseña, y el log no la contiene
