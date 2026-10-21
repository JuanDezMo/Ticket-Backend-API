import type { Express } from 'express';
import { loadEnv, type Env } from '../../src/config/env.js';
import { buildContainer, type Container, type ContainerOverrides } from '../../src/container.js';
import { createApp } from '../../src/app.js';
import { createDatabase, type Db } from '../../src/db/database.js';
import { migrateToLatest } from '../../src/db/migrate.js';
import { createLogger, type Logger } from '../../src/shared/logger.js';

export interface TestContext {
  app: Express;
  db: Db;
  env: Env;
  container: Container;
  logger: Logger;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export function testEnv(overrides: Record<string, string | undefined> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    JWT_SECRET: 'test-secret-with-more-than-16-chars',
    JWT_EXPIRES_IN_SECONDS: '3600',
    ...overrides,
  });
}

export async function createTestContext(
  envOverrides: Record<string, string | undefined> = {},
  containerOverrides: ContainerOverrides = {},
  logger: Logger = createLogger('silent'),
): Promise<TestContext> {
  const env = testEnv(envOverrides);
  const db = createDatabase(env.DATABASE_URL);
  await migrateToLatest(db);
  const container = buildContainer(env, db, logger, containerOverrides);
  return {
    app: createApp(container),
    db,
    env,
    container,
    logger,
    // Deja la BD limpia entre tests
    reset: async () => {
      // seats se borra en cascada con events
      await db.deleteFrom('events').execute();
      await db.deleteFrom('users').execute();
    },
    close: async () => {
      await db.destroy();
    },
  };
}
