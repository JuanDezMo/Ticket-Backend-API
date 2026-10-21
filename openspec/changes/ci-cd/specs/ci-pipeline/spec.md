## ADDED Requirements

### Requirement: Verificaciones obligatorias por commit
El pipeline SHALL ejecutar, para cada commit nuevo en `main` del repositorio, la instalación con lockfile congelado, `pnpm lint`, `pnpm arch`, `pnpm build` y `pnpm test` (con PostgreSQL real vía Testcontainers). Si cualquiera falla, el build MUST quedar fallido y MUST NOT construir la imagen ni desplegar.

#### Scenario: Commit que pasa las verificaciones
- **WHEN** se commitea en `main` un cambio que pasa lint, arch, build y pruebas
- **THEN** el pipeline continúa a la construcción de la imagen y publica el reporte JUnit de las pruebas

#### Scenario: Prueba fallida
- **WHEN** una prueba falla
- **THEN** el build queda fallido, el reporte JUnit muestra la prueba fallida y no se construye la imagen

#### Scenario: Solo entra lo commiteado
- **WHEN** el árbol de trabajo tiene cambios sin commitear
- **THEN** el pipeline usa solo el contenido del último commit de `main`

### Requirement: Imagen identificada por commit
El pipeline SHALL construir la imagen con el `Dockerfile` del repositorio y etiquetarla `ticket-api:<commit corto>`. La imagen desplegada MUST ser la misma que pasó el smoke test, sin recompilar.

#### Scenario: Etiqueta del commit
- **WHEN** el pipeline construye la imagen del commit `abc1234`
- **THEN** existe la imagen `ticket-api:abc1234` en el Docker local

### Requirement: Smoke test de la imagen
Antes de desplegar, el pipeline SHALL levantar la imagen junto a un PostgreSQL efímero, sin puertos publicados ni volúmenes persistentes, y MUST exigir que el contenedor quede `healthy` (migraciones aplicadas y `/health` respondiendo). Los recursos del smoke test MUST eliminarse al terminar, pase o falle.

#### Scenario: Imagen sana
- **WHEN** la imagen arranca, migra y responde `/health`
- **THEN** la etapa pasa y se eliminan sus contenedores, red y volúmenes

#### Scenario: Imagen que no arranca
- **WHEN** la imagen no queda `healthy` dentro del tiempo de espera
- **THEN** el build queda fallido, el log muestra los logs del contenedor, no se despliega y los recursos efímeros se eliminan

### Requirement: Despliegue local con aprobación manual
El despliegue SHALL ocurrir solo desde `main`, después de una aprobación manual, reemplazando el contenedor `ticket-api` del proyecto Compose local por la imagen del commit y conservando la base de datos. Si nadie aprueba dentro del tiempo de espera, el build MUST terminar sin desplegar. Si el contenedor desplegado no queda `healthy`, la etapa MUST fallar.

#### Scenario: Despliegue aprobado
- **WHEN** se aprueba el despliegue del build del commit `abc1234`
- **THEN** el contenedor `ticket-api` del proyecto local corre `ticket-api:abc1234`, queda `healthy` y los datos de PostgreSQL se conservan

#### Scenario: Sin aprobación
- **WHEN** nadie aprueba el despliegue dentro del tiempo de espera
- **THEN** el build termina como abortado y el contenedor desplegado no cambia

#### Scenario: Volver a una versión anterior
- **WHEN** se ejecuta el procedimiento documentado con la etiqueta de un commit anterior
- **THEN** el contenedor `ticket-api` vuelve a esa imagen sin recompilar

### Requirement: Secretos fuera del repositorio y del log
Los secretos de despliegue (`JWT_SECRET`, `POSTGRES_PASSWORD`, `PAYMENT_GATEWAY_API_KEY`, credenciales del seed) y la contraseña del admin de Jenkins MUST NOT versionarse ni aparecer en el log de los builds. El pipeline SHALL leerlos de credenciales de Jenkins.

#### Scenario: Log del despliegue
- **WHEN** se revisa el log de un build que desplegó
- **THEN** no aparece ningún valor de los secretos

### Requirement: Jenkins reproducible desde el repositorio
El repositorio SHALL incluir lo necesario para levantar Jenkins en local con un solo comando de Docker Compose, con el usuario admin, la credencial de despliegue y el job del pipeline ya configurados, sin pasos manuales en la interfaz de Jenkins.

#### Scenario: Levantar Jenkins desde cero
- **WHEN** se copia `ci/jenkins/.env.example` a `ci/jenkins/.env`, se define la contraseña y se ejecuta `docker compose up -d --build` en `ci/jenkins/`
- **THEN** Jenkins queda disponible en `http://127.0.0.1:8081` con el job `ticket-api` creado, y su primer build pasa sobre el último commit de `main`
