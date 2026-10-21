import { ConfigError, loadEnv, type Env } from './config/env.js';
import { createApp } from './app.js';
import { buildContainer } from './container.js';
import { createDatabase } from './db/database.js';
import { migrateToLatest } from './db/migrate.js';
import { createLogger } from './shared/logger.js';

function readEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const env = readEnvOrExit();
  const logger = createLogger(env.LOG_LEVEL);
  const db = createDatabase(env.DATABASE_URL);

  const applied = await migrateToLatest(db);
  if (applied.length > 0) logger.info({ migrations: applied }, 'Migrations applied');

  const container = buildContainer(env, db, logger);
  await container.adminSeeder.seed();
  container.reservationExpiryJob.start();

  const server = createApp(container).listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'ticket-api listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    container.reservationExpiryJob.stop();
    server.close(() => {
      void db.destroy().then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('Fatal error during startup', error);
  process.exit(1);
});
