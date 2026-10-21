// Pipeline de CI/CD de ticket-api (ver docs/ci-cd.md).
// El job, su disparador (revisión del repo cada 2 min) y las credenciales se definen en ci/jenkins/casc.yaml.
pipeline {
  agent any

  options {
    skipDefaultCheckout()
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    // Sin timeout global: incluiría la espera de la aprobación. Los timeouts van por etapa.
  }

  environment {
    CI = 'true'
    // El PostgreSQL de Testcontainers publica su puerto en el host, no en este contenedor
    TESTCONTAINERS_HOST_OVERRIDE = 'host.docker.internal'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          currentBuild.description = "ticket-api:${env.IMAGE_TAG}"
        }
      }
    }

    stage('Install') {
      steps {
        sh 'pnpm install --frozen-lockfile'
      }
    }

    stage('Quality') {
      parallel {
        stage('Lint') {
          steps {
            sh 'pnpm lint'
          }
        }
        stage('Arch') {
          steps {
            sh 'pnpm arch'
          }
        }
      }
    }

    stage('Build') {
      steps {
        sh 'pnpm build'
      }
    }

    stage('Test') {
      options {
        timeout(time: 15, unit: 'MINUTES')
      }
      steps {
        sh 'rm -rf reports && pnpm test'
      }
      post {
        always {
          junit testResults: 'reports/junit.xml', allowEmptyResults: true
        }
      }
    }

    stage('Image') {
      steps {
        sh 'docker build -t ticket-api:$IMAGE_TAG .'
      }
    }

    stage('Smoke') {
      options {
        timeout(time: 5, unit: 'MINUTES')
      }
      environment {
        COMPOSE_PROJECT_NAME = "ticket-ci-${env.BUILD_NUMBER}"
        SMOKE = 'docker compose --env-file smoke.env -f docker-compose.ci.yml'
      }
      steps {
        // Secretos de prueba generados en el build; `set +x` evita que el trazado los imprima
        sh '''
          set +x
          umask 077
          {
            echo "TICKET_API_TAG=$IMAGE_TAG"
            echo "JWT_SECRET=$(openssl rand -hex 32)"
            echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
            echo "PAYMENT_GATEWAY_API_KEY=smoke-$(openssl rand -hex 8)"
          } > smoke.env
          set -x
          $SMOKE up -d --wait --wait-timeout 90
          $SMOKE logs ticket-api | grep -q 'Migrations applied'
        '''
      }
      post {
        failure {
          sh '$SMOKE logs --tail=100 || true'
        }
        always {
          sh '$SMOKE down -v --remove-orphans || true; rm -f smoke.env'
        }
      }
    }

    // El job está atado a `main` (casc.yaml): todo build que llega aquí es de main
    stage('Deploy') {
      options {
        // Si nadie aprueba en 30 minutos, el build queda abortado y no se despliega
        timeout(time: 30, unit: 'MINUTES')
      }
      input {
        message "¿Desplegar ticket-api:${env.IMAGE_TAG} en el entorno local?"
        ok 'Desplegar'
      }
      steps {
        withCredentials([file(credentialsId: 'ticket-api-env', variable: 'DEPLOY_ENV')]) {
          // Mismo proyecto que el stack manual: reemplaza el contenedor y conserva el volumen de PostgreSQL
          sh '''
            export TICKET_API_TAG=$IMAGE_TAG
            DEPLOY="docker compose -p ticket_backend_api --env-file $DEPLOY_ENV -f docker-compose.yml"
            $DEPLOY up -d --no-build ticket-api
            CONTAINER=$($DEPLOY ps -q ticket-api)
            for i in $(seq 1 30); do
              STATUS=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER")
              if [ "$STATUS" = healthy ]; then
                echo "ticket-api:$IMAGE_TAG desplegado y healthy"
                exit 0
              fi
              sleep 2
            done
            docker logs --tail=100 "$CONTAINER"
            echo "ticket-api:$IMAGE_TAG no quedó healthy en 60 s"
            exit 1
          '''
        }
      }
    }
  }
}
