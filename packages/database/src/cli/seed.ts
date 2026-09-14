import { createDatabase } from '../client.js';
import { runSeeds } from '../seed.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is not set\n');
    process.exit(1);
  }

  const { db, sql, close } = createDatabase({ url, maxConnections: 1 });
  try {
    const executed = await runSeeds({ db, sql }, (message) => process.stdout.write(`${message}\n`));
    process.stdout.write(`seeded ${executed.length} set(s)\n`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `seeding failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
