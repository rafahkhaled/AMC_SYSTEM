import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDatabase>['db'];

export interface DatabaseOptions {
  readonly url: string;
  /** Connection ceiling. The API and the worker each hold their own pool. */
  readonly maxConnections?: number;
  /** Seconds a connection may sit idle before it is returned. */
  readonly idleTimeoutSeconds?: number;
  /** Seconds a single statement may run before Postgres cancels it. */
  readonly statementTimeoutSeconds?: number;
  readonly onNotice?: (notice: unknown) => void;
}

/**
 * One pool per process, created at boot and closed on shutdown.
 *
 * The statement timeout is set on every connection rather than left to chance.
 * An unbounded query on the invoice tables would otherwise hold a connection
 * until someone notices, and by then the whole API is waiting behind it.
 */
export function createDatabase(options: DatabaseOptions): {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sql: postgres.Sql;
  close: () => Promise<void>;
} {
  const sql = postgres(options.url, {
    max: options.maxConnections ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    connection: {
      application_name: 'amc',
      statement_timeout: (options.statementTimeoutSeconds ?? 30) * 1000,
      // Business rules read Asia/Dubai explicitly through the Clock port.
      // The connection stays in UTC so that a stored timestamp means one thing.
      timezone: 'UTC',
    },
    onnotice: options.onNotice ?? (() => {}),
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
