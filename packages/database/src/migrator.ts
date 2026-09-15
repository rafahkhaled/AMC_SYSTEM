import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type postgres from 'postgres';

export interface MigrationRecord {
  readonly filename: string;
  readonly appliedAt: Date;
}

/**
 * A deliberately small migration runner.
 *
 * Each file runs once, inside its own transaction, in filename order, and the
 * whole run holds an advisory lock so two processes starting at the same moment
 * cannot both migrate. Applied filenames are recorded with a checksum: if a
 * file that already ran has since been edited, the run stops rather than
 * pretending the database matches the code.
 */
const ADVISORY_LOCK_KEY = 4_150_271_837;

export async function runMigrations(
  sql: postgres.Sql,
  directory: string,
  log: (message: string) => void = () => {},
): Promise<string[]> {
  /*
   * The lock comes first, before anything is created.
   *
   * CREATE TABLE IF NOT EXISTS is not safe to run concurrently: two sessions
   * both find the table missing and both try to create it, and one dies on a
   * duplicate key in the system catalogue rather than on anything this code
   * can see. That is a real failure this runner hit the moment several test
   * packages migrated the same database at once.
   */
  await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`;

  const applied: string[] = [];

  try {
    // Inside the try, so a failure here still releases the lock. A leaked
    // advisory lock outlives the process holding it only until it exits, but
    // it would block every other migration in the meantime.
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text        PRIMARY KEY,
        checksum    text        NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `;

    const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    const done = await sql<{ filename: string; checksum: string }[]>`
      SELECT filename, checksum FROM schema_migrations
    `;
    const alreadyApplied = new Map(done.map((row) => [row.filename, row.checksum]));

    for (const filename of files) {
      const contents = await readFile(join(directory, filename), 'utf8');
      const checksum = await digest(contents);
      const previous = alreadyApplied.get(filename);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${filename} has changed since it was applied. Add a new migration instead of editing one that has already run.`,
          );
        }
        continue;
      }

      log(`applying ${filename}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`
          INSERT INTO schema_migrations (filename, checksum) VALUES (${filename}, ${checksum})
        `;
      });
      applied.push(filename);
    }
  } finally {
    await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
  }

  return applied;
}

async function digest(contents: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(contents.trim()).digest('hex');
}

export async function appliedMigrations(sql: postgres.Sql): Promise<MigrationRecord[]> {
  const rows = await sql<{ filename: string; applied_at: Date }[]>`
    SELECT filename, applied_at FROM schema_migrations ORDER BY filename
  `;
  return rows.map((row) => ({ filename: row.filename, appliedAt: row.applied_at }));
}
