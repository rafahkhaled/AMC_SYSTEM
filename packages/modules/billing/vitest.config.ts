import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every layer. A directory left out of this list does not fail; its tests
    // simply never run, and the suite reports success without them.
    include: ['{domain,application,infrastructure}/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
