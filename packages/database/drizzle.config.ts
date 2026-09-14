import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit generates migrations by comparing the schema in code against the
 * migrations already applied. Generated files are reviewed and committed like
 * any other code: a migration that nobody read is a migration nobody can undo.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://amc@127.0.0.1:5433/amc',
  },
  strict: true,
  verbose: true,
});
