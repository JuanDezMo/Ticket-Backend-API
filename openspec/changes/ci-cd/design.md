## Context

- `Dockerfile` multi-stage (deps → build → prod-deps → runtime), con usuario `node`, `HEALTHCHECK` sobre `/health` y migraciones al arrancar.
- `docker-compose.yml` levanta `postgres` y `ticket-api` (`build: .`), y lee los secretos de `.env`. Varias variables son obligatorias (`:?`), entre ellas `PAYMENT_GATEWAY_URL`, que además se valida como URL.
- Las pruebas usan Testcontainers: `tests/helpers/global-setup.ts` levanta un `postgres:16` para **toda** corrida de vitest. La pasarela se simula con MSW, así que CI no necesita la pasarela real.
- No hay remoto git: el repo vive solo en el disco del usuario, que hace los commits a mano.
- En el host: Docker 29 y Compose 5. El grupo `docker` tiene GID 999 y el usuario UID 1000.

## Goals / Non-Goals

**Goals:**
- Que cada commit en `main` pase automáticamente lint, arch, build y pruebas con PostgreSQL real.
- Que la imagen desplegada sea exactamente la que pasó el smoke test, identificada por el commit.
- Que Jenkins se levante desde el repo con un comando, sin configurarlo a mano en la UI.

**Non-Goals:**
- Alta disponibilidad, agentes distribuidos o un registry.
- Cambiar cómo se ejecutan las pruebas.

## Decisions

### 1. Jenkins en Docker con el Docker del host
`ci/jenkins/docker-compose.yml` levanta un solo servicio `jenkins`:
- Imagen propia (`ci/jenkins/Dockerfile`) basada en `jenkins/jenkins:<LTS>-jdk21` con versión fija. Agrega:
  - Docker CLI y el plugin de Compose (repositorio apt oficial de Docker);
  - Node 22 copiado de la imagen `node:22-slim` (la misma base que la app) y `corepack enable`, para que `packageManager` fije pnpm. Se descarta el script de NodeSource para no ejecutar `curl | bash`;
  - los plugins de `plugins.txt` vía `jenkins-plugin-cli`.
- Volúmenes:
  - `jenkins_home` (persistente: jobs, historial y caché del store de pnpm);
  - `/var/run/docker.sock`;
  - el repo en `/repos/ticket_backend_api:ro`;
  - el `.env` del repo en `/run/secrets/ticket-api.env:ro`.
- `group_add: ["${DOCKER_GID:-999}"]` para que el usuario `jenkins` use el socket sin ser root.
- `extra_hosts: host.docker.internal:host-gateway`.
- Puerto `8081:8080`, porque `3000` es de la API y `8080` de la pasarela.
- *Alternativa:* Docker-in-Docker (`docker:dind`). Se descarta: requiere `privileged`, duplica la caché de imágenes y el despliegue local debe afectar al Docker del host.
- *Riesgo aceptado:* quien controla Jenkins controla el Docker del host. Es un laboratorio local: la UI solo se publica en `127.0.0.1`.

### 2. Los builds corren en el controller
Con un solo executor en el controller y Node instalado en la imagen. Para un laboratorio local evita configurar agentes. Además, Testcontainers corre en el mismo contenedor que tiene el socket.
- *Alternativa:* `agent { docker { image 'node:22' } }`. Se descarta: Testcontainers dentro de un contenedor hermano necesita más configuración de red y montar el socket dos veces.

### 3. Testcontainers desde el contenedor de Jenkins
El PostgreSQL de las pruebas lo crea el Docker del host, y publica su puerto en el host, no en el contenedor de Jenkins. Se define `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` en el entorno del pipeline para que los tests se conecten a través del host. Ryuk, el limpiador de Testcontainers, queda activo para borrar contenedores huérfanos si un build se interrumpe.

### 4. Código desde el repo local montado
- El job clona `file:///repos/ticket_backend_api`, rama `main`. Solo entra lo commiteado: el árbol de trabajo con cambios sin commitear no afecta al build.
- El plugin Git bloquea por seguridad los checkouts locales. Se habilita con `-Dhudson.plugins.git.GitSCM.ALLOW_LOCAL_CHECKOUT=true` en `JAVA_OPTS`, aceptable porque el repo es del mismo usuario.
- Por la diferencia de dueño del directorio montado, la imagen configura `git config --system --add safe.directory /repos/ticket_backend_api`.
- Disparador: revisar el repo cada 2 minutos (`H/2 * * * *`), porque sin remoto no hay webhooks. Se declara en el job de `casc.yaml` y **no** en el `Jenkinsfile`: un `triggers { pollSCM }` del `Jenkinsfile` solo se registra después del primer build, y hasta entonces los commits no dispararían nada.

### 5. Configuración como código (JCasC)
`ci/jenkins/casc.yaml` define:
- el usuario admin, con la contraseña desde `JENKINS_ADMIN_PASSWORD` en `ci/jenkins/.env`, que no se versiona;
- un executor y sin registro público;
- la credencial `ticket-api-env` (*secret file*), leída de `/run/secrets/ticket-api.env`;
- el job `ticket-api` (Pipeline from SCM), creado con el plugin `job-dsl`, que apunta al repo montado (rama `main`) y al `Jenkinsfile`, con el disparador de revisión del repo.

Se desactiva el asistente de instalación con `-Djenkins.install.runSetupWizard=false`.

### 6. Etapas del `Jenkinsfile`
Opciones globales: `timestamps()`, `disableConcurrentBuilds()` y `buildDiscarder(logRotator(numToKeepStr: '20'))`. **Sin timeout global**, porque incluiría la espera de la aprobación. Los timeouts van por etapa: Test 15 min y Deploy 30 min (que cubre el `input`). Variables: `CI=true`, `TESTCONTAINERS_HOST_OVERRIDE` e `IMAGE_TAG = <commit corto>`.

| Etapa | Comando | Notas |
|---|---|---|
| Checkout | `checkout scm` | Calcula `IMAGE_TAG` |
| Install | `pnpm install --frozen-lockfile` | El store queda en `jenkins_home` |
| Quality | `pnpm lint` ∥ `pnpm arch` | `parallel` |
| Build | `pnpm build` | |
| Test | `pnpm test` | JUnit en `reports/junit.xml`, publicado en `post { always }` |
| Image | `docker build -t ticket-api:${IMAGE_TAG} .` | También etiqueta `ticket-api:latest-ci` |
| Smoke | `docker compose -f docker-compose.ci.yml -p ticket-ci-${BUILD_NUMBER} up -d --wait` | Ver decisión 7 |
| Deploy | `input` y luego `docker compose ... up -d --no-build` | Solo en `main`; ver decisión 8 |

Si una etapa falla, las siguientes no corren.

### 7. Smoke test
`docker-compose.ci.yml`:
- `postgres:16` sin volumen y sin puertos;
- `ticket-api` con `image: ticket-api:${TICKET_API_TAG}`, sin puertos, con secretos de prueba generados en el pipeline (`JWT_SECRET` aleatorio) y `PAYMENT_GATEWAY_URL=http://payment-gateway.invalid:8080`. Es una URL válida pero inexistente: el smoke test no hace pagos.

`up -d --wait` espera a que el `HEALTHCHECK` de la imagen quede `healthy`, lo que implica que conectó a la BD, migró y responde `/health`. Además se verifica en el log el mensaje `Migrations applied`. En `post { always }` se ejecuta `down -v`, que borra los contenedores, la red y los volúmenes del proyecto `ticket-ci-${BUILD_NUMBER}`, pase o falle.

### 8. Despliegue local con aprobación
- El job está atado a la rama `main` en `casc.yaml`, así que todo build es de `main`. No se usa `when { branch 'main' }`, que solo funciona en Multibranch Pipeline (depende de `BRANCH_NAME`).
- El `input` va dentro de los `steps` y no como directiva `input {}` de la etapa: la directiva se evalúa antes de que `IMAGE_TAG` (calculada en Checkout) esté disponible, y el mensaje mostraba `ticket-api:null` (detectado en el primer build).
- Después de un `input` ("¿Desplegar ticket-api:<tag>?") con un tiempo de espera de 30 minutos. Si nadie aprueba, el build termina como *aborted* y no como fallido.
- Comando: `docker compose -p ticket_backend_api --env-file <credencial ticket-api-env> -f docker-compose.yml up -d --no-build ticket-api`, con `TICKET_API_TAG=${IMAGE_TAG}`.
  - Usa el mismo nombre de proyecto que el stack manual del usuario, así que reemplaza ese contenedor y reutiliza el volumen `postgres_data`.
  - `postgres` solo se crea si no existe.
- Después, espera a que el contenedor quede `healthy` (`docker inspect`). Si no lo logra en 60 s, la etapa falla y muestra los últimos logs.
- `docker-compose.yml` agrega `image: ticket-api:${TICKET_API_TAG:-local}` junto a `build: .`. Con `--build`, el uso manual sigue compilando la imagen; con `--no-build`, usa la etiqueta indicada.
- **Volver atrás:** `TICKET_API_TAG=<tag anterior> docker compose -p ticket_backend_api up -d --no-build ticket-api`. Las imágenes anteriores quedan en el Docker local. Se documenta en `docs/ci-cd.md`.

### 9. Secretos
- No se versionan secretos: `ci/jenkins/.env` está cubierto por `.env.*` en `.gitignore`, y solo se versiona `ci/jenkins/.env.example`.
- El `.env` de despliegue entra como credencial *secret file* y se usa con `withCredentials`, que oculta su valor en el log.
- El smoke test usa valores de prueba generados en el build.

### 10. Pruebas JUnit solo en CI
`vitest.config.ts` agrega el reporter `junit` con `outputFile: 'reports/junit.xml'` solo cuando `process.env.CI` está definida. En local no cambia nada. `reports/` se agrega a `.gitignore`.

## Risks / Trade-offs

- [Jenkins tiene acceso al Docker del host] → equivale a acceso root en la máquina. Se limita a `127.0.0.1:8081` con usuario y contraseña, y se documenta.
- [El despliegue reemplaza el stack manual] → es intencional (deploy "local"). El `input` evita despliegues sin querer, y se documenta cómo volver atrás.
- [Testcontainers a través de `host.docker.internal`] → si falla en algún host, la alternativa documentada es `TESTCONTAINERS_HOST_OVERRIDE=<IP del gateway de docker0>`. Es lo primero que se valida al implementar (tarea 1.4).
- [Las imágenes por commit se acumulan] → `docs/ci-cd.md` documenta `docker image prune` con un filtro por etiqueta. La limpieza automática queda fuera de alcance.
- [Un solo executor] → mientras un build espera la aprobación, ocupa el executor, y los commits nuevos se encolan hasta aprobar, abortar o que venzan los 30 minutos. Aceptado para un laboratorio local.
- [Revisar el repo cada 2 minutos] → un commit tarda hasta 2 minutos en disparar el build. También se puede lanzar con "Build Now".
