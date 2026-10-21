# user-registration Specification

## Purpose

Permite el registro público de cuentas con rol `USER`, con email único y contraseña protegida, como base de la identidad de la plataforma.

## Requirements

### Requirement: Registro de usuario
El sistema SHALL exponer `POST /auth/register` sin autenticación, que recibe `email` y `password`, crea siempre un usuario con rol `USER` y responde `201` con `{ id, email, role, createdAt }`.

#### Scenario: Registro exitoso
- **WHEN** se envía un email válido y una contraseña válida
- **THEN** el sistema responde `201` con `role` `USER`

### Requirement: El registro público no asigna roles
El sistema MUST rechazar con `400` y `code` `VALIDATION_ERROR` cualquier solicitud de registro que incluya el campo `role`, y MUST NOT crear usuarios `ADMIN` por esta vía.

#### Scenario: Intento de registrarse como ADMIN
- **WHEN** se envía `role` `ADMIN` en el registro público
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR` y no crea ningún usuario

### Requirement: Email único
El sistema MUST rechazar con `409` y `code` `EMAIL_ALREADY_EXISTS` el registro de un email ya existente, sin distinguir mayúsculas de minúsculas, y SHALL guardar los emails en minúsculas.

#### Scenario: Email repetido
- **WHEN** se registra un email que ya existe
- **THEN** el sistema responde `409` con `code` `EMAIL_ALREADY_EXISTS` y no crea otro usuario

#### Scenario: Email repetido con otras mayúsculas
- **WHEN** existe `ana@mail.com` y se registra `Ana@Mail.com`
- **THEN** el sistema responde `409`

### Requirement: Validación de datos de registro
El sistema SHALL exigir un email con formato válido y una contraseña de al menos 8 caracteres; en caso contrario responde `400` con `code` `VALIDATION_ERROR`.

#### Scenario: Contraseña corta
- **WHEN** la contraseña tiene menos de 8 caracteres
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

#### Scenario: Email con formato inválido
- **WHEN** el email no tiene formato válido
- **THEN** el sistema responde `400` con `code` `VALIDATION_ERROR`

### Requirement: Protección de la contraseña
El sistema MUST almacenar la contraseña únicamente como hash con sal, y MUST NOT devolverla ni registrarla en logs.

#### Scenario: Datos persistidos
- **WHEN** se crea un usuario
- **THEN** el registro guardado contiene un hash y no la contraseña original

#### Scenario: Respuesta sin datos sensibles
- **WHEN** el registro es exitoso
- **THEN** el cuerpo de la respuesta no incluye contraseña ni hash
