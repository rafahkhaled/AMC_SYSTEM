#!/usr/bin/env node
/**
 * Asks the database what is wrong with itself.
 *
 * Reading a schema tells you what somebody meant; asking it tells you what is
 * actually there. This finds the two things that are invisible in a migration
 * file and expensive later: foreign keys Postgres left unindexed, and tables
 * that say nothing about themselves at a psql prompt.
 *
 *   node scripts/schema-audit.mjs [--url postgres://amc@127.0.0.1:5433/amc]
 *
 * Some omissions are deliberate. They are listed below with the reason, so
 * this stays a report worth reading rather than a list everybody learns to
 * ignore.
 */
import postgres from 'postgres';

const url = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : (process.env.DATABASE_URL ?? 'postgres://amc@127.0.0.1:5433/amc');

/** Unindexed on purpose: small tables where an index would cost writes and serve no reader. */
const ACCEPTED_UNINDEXED = new Map([
  [
    'client_contact_log.contact_id',
    'the contacts table stays small and nothing queries the log by person',
  ],
  [
    'client_credentials.retired_by',
    'a handful of rows per client, read only when somebody asks who retired one',
  ],
]);

const sql = postgres(url, { max: 2, onnotice: () => {} });

try {
  const unindexed = await sql`
    SELECT c.conrelid::regclass::text || '.' || a.attname AS column
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f'
      AND c.connamespace = 'public'::regnamespace
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid AND i.indkey[0] = k.attnum
      )
    ORDER BY 1`;

  const uncommented = await sql`
    SELECT c.relname AS table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND obj_description(c.oid) IS NULL
    ORDER BY 1`;

  const surprises = unindexed.filter((row) => !ACCEPTED_UNINDEXED.has(row.column));
  const accepted = unindexed.filter((row) => ACCEPTED_UNINDEXED.has(row.column));

  console.log('Foreign keys with no index');
  if (surprises.length === 0) console.log('  none that were not expected');
  for (const row of surprises) console.log(`  ${row.column}`);
  for (const row of accepted) {
    console.log(`  ${row.column}  (accepted: ${ACCEPTED_UNINDEXED.get(row.column)})`);
  }

  console.log('\nTables with nothing to say for themselves');
  if (uncommented.length === 0) console.log('  none');
  for (const row of uncommented) console.log(`  ${row.table}`);

  const problems = surprises.length + uncommented.length;
  console.log(`\n${problems === 0 ? 'Nothing to fix.' : `${problems} to look at.`}`);
  process.exit(problems === 0 ? 0 : 1);
} finally {
  await sql.end({ timeout: 5 });
}
