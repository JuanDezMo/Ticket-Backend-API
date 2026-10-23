## 1. Jenkins local

- [x] 1.1 Crear `ci/jenkins/Dockerfile` según la decisión 1 del design:
  - base `jenkins/jenkins:<LTS>-jdk21`, con la versión LTS vigente fijada (comprobarla con `docker pull`);
  - Docker CLI y `docker-compose-plugin` desde el repositorio apt oficial de Docker;
  - Node 22 copiado de `node:22-slim` (misma base que la app, sin `curl | bash` de NodeSource) y `corepack enable`;
  - `git config --system --add safe.directory /repos/ticket_backend_api`;
  - plugins con `jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt`.

  Verificar con `docker build ci/jenkins`
- [x] 1.2 Crear `ci/jenkins/plugins.txt` con: `workflow-aggregator`, `git`, `configuration-as-code`, `job-dsl`, `credentials-binding`, `junit`, `timestamper`, `pipeline-stage-view`. Verificar que la imagen de 1.1 los instala sin conflictos
- [x] 1.3 Crear `ci/jenkins/casc.yaml` (decisión 5): admin desde `${JENKINS_ADMIN_PASSWORD}`, 1 executor, credencial `ticket-api-env` (*secret file* desde `/run/secrets/ticket-api.env`) y el job `ticket-api` con `pipelineJob` de job-dsl (SCM git `file:///repos/ticket_backend_api`, rama `*/main`, `Jenkinsfile`, y el disparador `pollSCM` `H/2 * * * *` en las propiedades del job, no en el `Jenkinsfile`)
- [x] 1.4 Crear `ci/jenkins/docker-compose.yml` (decisión 1) y `ci/jenkins/.env.example` (`JENKINS_ADMIN_PASSWORD=` y `DOCKER_GID=999`), con estos `JAVA_OPTS`: `-Djenkins.install.runSetupWizard=false -Dhudson.plugins.git.GitSCM.ALLOW_LOCAL_CHECKOUT=true`, y `CASC_JENKINS_CONFIG`. Verificar con `docker compose up -d --build` en `ci/jenkins/`:
  - la UI responde en `127.0.0.1:8081` y el job `ticket-api` existe;
  - **antes de seguir**, desde el contenedor (`docker compose exec jenkins ...`), `docker ps` funciona y un `pnpm test` en un clon del repo levanta Testcontainers con `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` (decisión 3).

## 2. Pipeline

- [x] 2.1 En `vitest.config.ts`, agregar los reporters `default` y `junit` (`outputFile: 'reports/junit.xml'`) solo si `process.env.CI` está definida, y agregar `reports/` a `.gitignore`. Verificar que `pnpm test` en local no cambia y que `CI=true pnpm test` genera el XML
- [x] 2.2 Crear `docker-compose.ci.yml` (decisión 7): `postgres:16` y `ticket-api` con `image: ticket-api:${TICKET_API_TAG:?}`, sin `ports` ni volúmenes con nombre, y variables de prueba (`JWT_SECRET`, `POSTGRES_PASSWORD`, `PAYMENT_GATEWAY_URL=http://payment-gateway.invalid:8080`, `PAYMENT_GATEWAY_API_KEY`) leídas del entorno. Verificar a mano con `docker build -t ticket-api:manual . && TICKET_API_TAG=manual ... docker compose -f docker-compose.ci.yml -p ticket-ci-manual up -d --wait`, y luego `down -v`
- [x] 2.3 En `docker-compose.yml`, agregar `image: ticket-api:${TICKET_API_TAG:-local}` al servicio `ticket-api`, junto a `build: .`. Verificar que `docker compose up -d --build` sigue funcionando igual
- [x] 2.4 Agregar `ci` a `.dockerignore`. Verificar que `docker build .` no incluye `ci/` en el contexto
- [x] 2.5 Crear `Jenkinsfile` (decisiones 6, 7 y 8), sin timeout global (Test 15 min) y sin `triggers`, con las etapas Checkout, Install, Quality (parallel lint y arch), Build, Test (con `junit` en `post { always }`), Image, Smoke (con `down -v` en `post { always }` y logs del contenedor si falla) y Deploy (sin `when { branch }`, porque el job ya está atado a `main`; `input` dentro de los `steps` con `timeout` de etapa de 30 min, `withCredentials([file(credentialsId: 'ticket-api-env', ...)])`, `up -d --no-build ticket-api` y espera de `healthy` de 60 s). Los secretos del smoke test se generan en el build (`openssl rand -hex 32`) en un `smoke.env` del workspace con `umask 077`, que usan tanto `up` como `down -v`, y no se imprimen. Verificar la sintaxis con el linter declarativo de Jenkins (`curl -X POST -F "jenkinsfile=<Jenkinsfile" .../pipeline-model-converter/validate`)

## 3. Validación de punta a punta

- [x] 3.1 Con los archivos commiteados por el usuario, lanzar el job `ticket-api` y comprobar:
  - todas las etapas pasan hasta el `input`;
  - el reporte JUnit muestra las ~516 pruebas;
  - existe `ticket-api:<commit corto>`;
  - no quedan contenedores ni volúmenes `ticket-ci-*`.
- [x] 3.2 Aprobar el despliegue y comprobar que `ticket_backend_api-ticket-api-1` corre `ticket-api:<commit corto>` y queda `healthy`, que `curl localhost:3000/health` responde `UP` y que los datos existentes (eventos anteriores) siguen en `GET /events`
- [ ] 3.3 Casos negativos:
  - romper una prueba en una rama temporal o en un commit local revertible: el build falla en Test y no llega a Image;
  - dejar vencer el `input` (o abortarlo): el contenedor desplegado no cambia;
  - revisar el log de un despliegue: no aparece ningún secreto.
- [ ] 3.4 Volver atrás con el procedimiento documentado, usando la etiqueta del build anterior, y comprobar que el contenedor corre esa imagen

## 4. Documentación y cierre

- [x] 4.1 Crear `docs/ci-cd.md` con estas secciones:
  - requisitos;
  - cómo levantar Jenkins (`ci/jenkins/.env`, `docker compose up -d --build`, `127.0.0.1:8081`);
  - flujo del pipeline (tabla de etapas);
  - cómo se dispara (revisión cada 2 min o "Build Now");
  - despliegue y aprobación;
  - cómo volver atrás;
  - limpieza de imágenes (`docker image prune` con filtro);
  - riesgos (acceso al socket de Docker);
  - diagnóstico de Testcontainers (`TESTCONTAINERS_HOST_OVERRIDE`).
- [x] 4.2 En `README.md`, agregar una sección "CI/CD" breve con el enlace a `docs/ci-cd.md`
- [ ] 4.3 Correr `pnpm lint`, `pnpm build`, `pnpm arch` y `pnpm test`. Verificar que todo pasa, que Prettier acepta los YAML nuevos y que el último build del job está en verde
