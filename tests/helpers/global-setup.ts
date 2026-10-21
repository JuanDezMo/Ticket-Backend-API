import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | undefined;

// Un único PostgreSQL real para todos los tests de integración (no se usa BD en memoria)
export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16').start();
  process.env.TEST_DATABASE_URL = container.getConnectionUri();
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
