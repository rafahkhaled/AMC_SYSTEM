import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{domain,infrastructure}/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
