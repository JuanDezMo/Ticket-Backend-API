## Why

Hoy la calidad de `ticket-api` depende de correr a mano `pnpm lint`, `pnpm arch`, `pnpm build` y `pnpm test`, y el despliegue es un `docker compose up -d --build` manual. Nada asegura que cada commit pase las verificaciones ni que la imagen que se despliega sea la que se probó. Se quiere un CI/CD con Jenkins y Docker que se pueda levantar en local desde el propio repositorio.

## What Changes

- **Jenkins local en Docker** (`ci/jenkins/`): imagen propia con Node 22, pnpm (corepack), Docker CLI y Compose, y los plugins necesarios. Se configura con código (JCasC): usuario admin, credencial con el `.env` de despliegue y el job del pipeline ya creado. Usa el Docker del host mediante el socket.
- **Origen del código:** el repositorio local se monta en modo solo lectura y Jenkins lo clona desde `file://`. Solo entra al pipeline lo que está **commiteado** en `main`. Jenkins revisa el repo cada 2 minutos para detectar commits nuevos.
- **`Jenkinsfile`** declarativo con estas etapas:
  1. Checkout.
  2. Install (`pnpm install --frozen-lockfile`).
  3. Calidad: `pnpm lint` y `pnpm arch`, en paralelo.
  4. Build (`pnpm build`).
  5. Tests (`pnpm test`, con PostgreSQL real vía Testcontainers y reporte JUnit).
  6. Imagen: `docker build` con la etiqueta del commit.
  7. Smoke test: la imagen arranca, migra y responde `/health` junto a un PostgreSQL efímero.
  8. Despliegue local con aprobación manual.
- **`docker-compose.ci.yml`** para el smoke test, sin puertos publicados ni volúmenes persistentes.
- **`docker-compose.yml`**: el servicio `ticket-api` agrega `image: ticket-api:${TICKET_API_TAG:-local}`, para que el despliegue use la imagen ya probada sin recompilar. Con el uso manual actual (`up -d --build`) se comporta igual.
- **Documentación:** `docs/ci-cd.md` (cómo levantar Jenkins, el flujo y cómo volver atrás) y una sección en el `README.md`.

## Fuera de alcance

- Remoto git, webhooks y Multibranch Pipeline.
- Push a un registry y despliegue remoto (SSH).
- Agentes de Jenkins separados del controller.
- Correr `scripts/verify-gateway.sh` contra la pasarela real en el pipeline.
- Pipeline del proyecto `payment-gateway`.
- Separar las pruebas unitarias de las de integración: hoy el `globalSetup` de vitest levanta PostgreSQL en cualquier corrida.

## Capabilities

### New Capabilities

- `ci-pipeline`: integración y entrega continua de `ticket-api` con Jenkins y Docker. Cubre las verificaciones obligatorias, la imagen por commit, el smoke test, el despliegue con aprobación, el manejo de secretos y la limpieza de recursos efímeros.

### Modified Capabilities

Ninguna: el comportamiento de la API no cambia.

## Impact

- Archivos nuevos:
  - `Jenkinsfile` y `docker-compose.ci.yml`;
  - `ci/jenkins/Dockerfile`, `ci/jenkins/docker-compose.yml`, `ci/jenkins/plugins.txt`, `ci/jenkins/casc.yaml` y `ci/jenkins/.env.example`;
  - `docs/ci-cd.md`.
- Archivos modificados: `docker-compose.yml` (etiqueta de imagen), `vitest.config.ts` (reporte JUnit solo en CI), `.dockerignore` (excluye `ci/`), `.gitignore` (`ci/jenkins/.env` ya queda cubierto por `.env.*`; se verifica) y `README.md`.
- Requiere en el host: Docker con Compose. Jenkins usa los puertos `8081` (UI) y `50000` (agentes, no se publica).
- Sin cambios en el código de la aplicación, en la BD ni en las dependencias de producción.
