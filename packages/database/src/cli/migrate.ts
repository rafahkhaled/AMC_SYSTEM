import postgres from 'postgres';
import { appliedMigrations, runMigrations } from '../migrator.js';
import { MIGRATIONS_DIRECTORY } from '../paths.js';

/** Run pending migrations. Safe to run on every deploy, and on every boot. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is not set\n');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const applied = await runMigrations(sql, MIGRATIONS_DIRECTORY, (message) =>
      process.stdout.write(`${message}\n`),
    );
    const total = await appliedMigrations(sql);
    process.stdout.write(
      applied.length === 0
        ? `nothing to apply, ${total.length} migration(s) already in place\n`
        : `applied ${applied.length} migration(s), ${total.length} in place\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
