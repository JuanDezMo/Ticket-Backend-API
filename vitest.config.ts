import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/helpers/global-setup.ts'],
    // Los tests de integración comparten una sola BD; se ejecutan por archivo, no en paralelo
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // En CI (Jenkins) también se genera el reporte JUnit; en local la salida no cambia
    ...(process.env.CI && {
      reporters: ['default', 'junit'],
      outputFile: { junit: 'reports/junit.xml' },
    }),
  },
});
