import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { runMigrations } from '../migrator.js';
import { MIGRATIONS_DIRECTORY } from '../paths.js';
import * as schema from '../schema/index.js';

/**
 * Integration tests run against a real Postgres, because the things worth
 * testing here are the things an in-memory fake does not have: constraints,
 * transactions, triggers and the grants that make the audit log append-only.
 *
 * Isolation comes from a transaction per test that is always rolled back, so
 * tests leave nothing behind and can be re-run without cleaning up. Migrations
 * are applied once per process.
 *
 * One suite runs at a time, enforced by an advisory lock held for the life of
 * this handle. Vitest keeps files sequential inside a package, but the build
 * runs packages in parallel, and fixtures across packages use the same names —
 * `doc-1`, `c-1`, `user-a`. Two suites inserting the same primary key at the
 * same moment is a race that passes until the day it does not, which is what
 * it did. The lock is held on a reserved connection rather than a pooled one,
 * so no rollback releases it, and Postgres drops it on its own if a test
 * process dies.
 */
export interface TestDatabase {
  readonly sql: postgres.Sql;
  /**
   * Run a test body against a transaction that is rolled back afterwards,
   * whatever the body does. The rollback also covers a failing assertion.
   */
  inRollbackTransaction<T>(body: (tx: TransactionalDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type TransactionalDatabase = Parameters<
  Parameters<ReturnType<typeof drizzle<typeof schema>>['transaction']>[0]
>[0];

class RollbackSignal extends Error {
  constructor(readonly result: unknown) {
    super('rollback');
  }
}

/**
 * The key one suite holds against all the others.
 *
 * Distinct from the migrator's, which is taken and released inside this one.
 * Sharing a key would make a suite wait for its own lock forever.
 */
const SUITE_LOCK = 0x616d_6354;

export function testDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://amc@127.0.0.1:5433/amc_test'
  );
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const sql = postgres(testDatabaseUrl(), {
    max: 5,
    onnotice: () => {},
    connection: { application_name: 'amc-tests', timezone: 'UTC' },
  });

  /*
   * Reserved, not pooled. A session advisory lock belongs to the connection
   * that took it, and a pool would hand the next query to a different one.
   */
  const holder = await sql.reserve();
  await holder`SELECT pg_advisory_lock(${SUITE_LOCK})`;

  await runMigrations(sql, MIGRATIONS_DIRECTORY);
  const db = drizzle(sql, { schema });

  return {
    sql,
    async inRollbackTransaction<T>(body: (tx: TransactionalDatabase) => Promise<T>): Promise<T> {
      try {
        await db.transaction(async (tx) => {
          const result = await body(tx);
          // The only way out of a transaction without committing is to throw.
          throw new RollbackSignal(result);
        });
      } catch (error) {
        if (error instanceof RollbackSignal) return error.result as T;
        throw error;
      }
      throw new Error('unreachable: the rollback signal was swallowed');
    },
    close: async () => {
      // Released before the pool closes, so the next suite can start even if
      // this connection lingers.
      await holder`SELECT pg_advisory_unlock(${SUITE_LOCK})`;
      holder.release();
      await sql.end({ timeout: 5 });
    },
  };
}
