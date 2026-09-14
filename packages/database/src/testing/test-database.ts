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
      await sql.end({ timeout: 5 });
    },
  };
}
