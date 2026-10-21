# syntax=docker/dockerfile:1
# Jenkins local para el CI/CD de ticket-api (ver docs/ci-cd.md)

# Node 22: la misma base que la imagen de la aplicación
FROM node:22-slim AS node

FROM jenkins/jenkins:2.580.1-lts-jdk21
USER root

# Docker CLI y Compose (repositorio oficial de Docker): los builds usan el Docker del host por el socket
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg openssl \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

# Node 22 + corepack: pnpm queda fijado por "packageManager" del package.json
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
  && corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# El repo se monta con otro dueño: git debe confiar en él para clonarlo
RUN git config --system --add safe.directory /repos/ticket_backend_api \
  && git config --system --add safe.directory /repos/ticket_backend_api/.git

USER jenkins
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
