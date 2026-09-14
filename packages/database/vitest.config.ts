import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Integration tests share one Postgres instance. Each test runs inside a
    // transaction that is rolled back, so they cannot see each other's rows,
    // but they must not run at the same instant against the same schema.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
