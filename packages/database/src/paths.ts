import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the .sql files live, resolved from the built output, not the cwd. */
export const MIGRATIONS_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);
