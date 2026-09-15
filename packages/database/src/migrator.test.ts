import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appliedMigrations, runMigrations } from './migrator.js';
import { MIGRATIONS_DIRECTORY } from './paths.js';
import { testDatabaseUrl } from './testing/test-database.js';

/**
 * These run against a throwaway database so that applying, re-applying and
 * tampering can all be exercised without disturbing the shared test database.
 */
describe('migration runner', () => {
  const databaseName = `amc_mig_${Math.random().toString(36).slice(2, 10)}`;
  let adminSql: postgres.Sql;
  let sql: postgres.Sql;
  let temporaryDirectory: string;

  beforeAll(async () => {
    const base = testDatabaseUrl();
    adminSql = postgres(base.replace(/\/[^/]*$/, '/postgres'), { max: 1, onnotice: () => {} });
    await adminSql.unsafe(`CREATE DATABASE ${databaseName}`);
    sql = postgres(base.replace(/\/[^/]*$/, `/${databaseName}`), { max: 1, onnotice: () => {} });
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'amc-migrations-'));
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await adminSql?.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminSql?.end({ timeout: 5 });
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('applies every migration on disk, in order, and records each one', async () => {
    const onDisk = (await readdir(MIGRATIONS_DIRECTORY)).filter((n) => n.endsWith('.sql')).sort();
    const applied = await runMigrations(sql, MIGRATIONS_DIRECTORY);

    // Compared against the directory rather than a hard-coded list, so adding
    // a migration does not break this test for the wrong reason.
    expect(applied).toEqual(onDisk);

    const records = await appliedMigrations(sql);
    expect(records.map((record) => record.filename)).toEqual(onDisk);
  });

  it('is safe to run again, which is what makes it safe on every deploy', async () => {
    const applied = await runMigrations(sql, MIGRATIONS_DIRECTORY);
    expect(applied).toEqual([]);
  });

  it('installs the extensions later tables depend on', async () => {
    const rows = await sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'citext', 'unaccent')
    `;
    expect(rows.map((row) => row.extname).sort()).toEqual(['citext', 'pgcrypto', 'unaccent']);
  });

  it('provides the updated_at trigger function every table will attach', async () => {
    const rows = await sql<{ proname: string }[]>`
      SELECT proname FROM pg_proc WHERE proname = 'set_updated_at'
    `;
    expect(rows).toHaveLength(1);
  });

  it('refuses to continue when an applied migration has been edited since', async () => {
    const file = join(temporaryDirectory, '9999_tamper.sql');
    await writeFile(file, 'SELECT 1;');
    await runMigrations(sql, temporaryDirectory);

    await writeFile(file, 'SELECT 2;');
    await expect(runMigrations(sql, temporaryDirectory)).rejects.toThrow(/has changed since/);
  });

  it('releases its lock when a migration fails, so the next run is not stuck', async () => {
    const brokenDirectory = await mkdtemp(join(tmpdir(), 'amc-broken-'));
    await writeFile(join(brokenDirectory, '0001_broken.sql'), 'THIS IS NOT SQL;');

    await expect(runMigrations(sql, brokenDirectory)).rejects.toThrow();

    const [lock] = await sql<{ granted: boolean }[]>`
      SELECT pg_try_advisory_lock(4150271837) AS granted
    `;
    expect(lock?.granted).toBe(true);
    await sql`SELECT pg_advisory_unlock(4150271837)`;
    await rm(brokenDirectory, { recursive: true, force: true });
  });
});
