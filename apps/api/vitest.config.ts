import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    /*
     * The end-to-end suites each boot the whole application against their own
     * database, and the gate runs them all at once beside every other
     * package's tests. A request that takes 50 ms alone can take seconds then,
     * and the default 5 s limit failed tests that were only queued, not wrong.
     */
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
