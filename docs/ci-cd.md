# CI/CD de ticket-api con Jenkins y Docker

Pipeline local: cada commit en `main` pasa las verificaciones, se construye la imagen `ticket-api:<commit>`, se prueba con un smoke test y, con aprobación manual, se despliega en el stack de Docker Compose local.

Todo está en código: `Jenkinsfile` (pipeline), `ci/jenkins/casc.yaml` (Jenkins, credencial y job), `ci/jenkins/plugins.txt`, `ci/jenkins/Dockerfile` y `ci/jenkins/docker-compose.yml`. No se configura nada en la interfaz de Jenkins.

## 1. Requisitos

- Docker con el plugin de Compose.
- El `.env` de la raíz del repo completo (es el que usa el despliegue).
- Puerto `8081` libre en `127.0.0.1`.

## 2. Levantar Jenkins

```bash
cp ci/jenkins/.env.example ci/jenkins/.env
# Definir JENKINS_ADMIN_PASSWORD y, si cambia, DOCKER_GID (getent group docker | cut -d: -f3)
docker compose -f ci/jenkins/docker-compose.yml up -d --build
```

- UI: <http://127.0.0.1:8081>, usuario `admin` y la contraseña de `ci/jenkins/.env`.
- El job `ticket-api` ya existe. Se puede lanzar con **Build Now** o esperar al siguiente commit.
- `casc.yaml` se aplica en cada arranque. Después de cambiarlo, o de cambiar el `.env` de la raíz (la credencial se lee al arrancar): `docker compose -f ci/jenkins/docker-compose.yml restart`.
- Detener: `docker compose -f ci/jenkins/docker-compose.yml down`. Con `-v` también se borra el historial de builds.

## 3. Cómo se dispara

Jenkins clona el repo montado (`file:///repos/ticket_backend_api`, solo lectura) y **solo ve lo commiteado en `main`**. Los cambios sin commitear no afectan al build. Revisa el repo cada 2 minutos (`H/2 * * * *`, definido en `casc.yaml`), así que un commit tarda hasta 2 minutos en disparar el build.

## 4. Etapas

| Etapa | Qué hace | Si falla |
|---|---|---|
| Checkout | Clona `main` y calcula la etiqueta (`git rev-parse --short HEAD`) | Se detiene |
| Install | `pnpm install --frozen-lockfile` | Se detiene |
| Quality | `pnpm lint` y `pnpm arch` en paralelo | Se detiene |
| Build | `pnpm build` | Se detiene |
| Test | `pnpm test` con PostgreSQL real (Testcontainers); publica el reporte JUnit. Timeout 15 min | Se detiene; el reporte muestra qué falló |
| Image | `docker build -t ticket-api:<commit> .` | Se detiene |
| Smoke | Levanta la imagen con un PostgreSQL efímero (`docker-compose.ci.yml`, proyecto `ticket-ci-<build>`), exige `healthy` y `Migrations applied`. Siempre ejecuta `down -v` | Muestra los logs y se detiene |
| Deploy | Pide aprobación (30 min) y despliega (sección 5) | Muestra los logs del contenedor |

## 5. Despliegue y aprobación

Al llegar a **Deploy**, el build espera a que alguien pulse **Desplegar** en la UI. Si nadie aprueba en 30 minutos, el build queda *aborted* y no cambia nada.

Al aprobar se ejecuta:

```bash
TICKET_API_TAG=<commit> docker compose -p ticket_backend_api --env-file <credencial ticket-api-env> \
  -f docker-compose.yml up -d --no-build ticket-api
```

- Usa el mismo proyecto que el stack manual (`docker compose up -d --build` en la raíz): reemplaza el contenedor `ticket-api` y **conserva** el volumen de PostgreSQL.
- `--no-build` garantiza que corre la misma imagen que pasó el smoke test.
- La etapa falla si el contenedor no queda `healthy` en 60 s.

Mientras un build espera la aprobación ocupa el único executor: los commits nuevos se encolan hasta aprobar, abortar o que venzan los 30 minutos.

## 6. Volver a una versión anterior

Las imágenes de builds anteriores quedan en el Docker local:

```bash
docker image ls ticket-api                 # etiquetas disponibles (commit corto)
TICKET_API_TAG=<commit anterior> docker compose -p ticket_backend_api up -d --no-build ticket-api
```

Las migraciones no se revierten solas. Si la versión anterior no conoce una migración nueva, revisarla antes de volver atrás.

## 7. Limpieza de imágenes

Cada build deja una imagen `ticket-api:<commit>`. Para borrar las que no usa ningún contenedor:

```bash
docker image ls ticket-api --format '{{.Repository}}:{{.Tag}}' | grep -v ':local$' \
  | xargs -r docker image rm 2>/dev/null
```

Las imágenes en uso no se borran (Docker lo rechaza).

## 8. Secretos

- `ci/jenkins/.env` (contraseña de Jenkins) y el `.env` de la raíz no se versionan.
- El despliegue usa el `.env` de la raíz como credencial *secret file* (`ticket-api-env`) con `withCredentials`, sin imprimir su contenido.
- El smoke test genera secretos de prueba en cada build, con el trazado de comandos desactivado.

## 9. Riesgos

- **Jenkins tiene acceso al Docker del host** (socket montado), lo que equivale a acceso root en la máquina. Por eso la UI solo escucha en `127.0.0.1` y pide usuario y contraseña. No exponer el puerto `8081` fuera de la máquina.
- Los builds corren en el controller de Jenkins: es un laboratorio local, no una instalación de producción.

## 10. Diagnóstico

- **Testcontainers no conecta** (`ECONNREFUSED` al iniciar los tests): los tests usan `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`. Si en el host no funciona, usar la IP del bridge de Docker (`ip -4 addr show docker0`) en el `environment` del `Jenkinsfile`.
- **`permission denied` en `/var/run/docker.sock`**: `DOCKER_GID` en `ci/jenkins/.env` no coincide con `getent group docker`.
- **El job no ve commits nuevos**: revisar que el commit esté en `main` y la sección *Git Polling Log* del job.
