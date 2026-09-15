import { type Database, createDatabase } from '@amc/database';
import { Global, Module } from '@nestjs/common';
import type { Sql } from 'postgres';
import { ENVIRONMENT, type Environment } from '../config/env.js';

export const DATABASE = Symbol('DATABASE');
export const DATABASE_POOL = Symbol('DATABASE_POOL');

export interface DatabasePool {
  readonly db: Database;
  /** The raw handle, for the few places that need SQL rather than the ORM. */
  readonly sql: Sql;
  readonly close: () => Promise<void>;
}

/**
 * One connection pool for the process, opened at boot. main.ts closes it on
 * shutdown, so a deploy drains connections instead of dropping them and
 * leaving Postgres to work it out.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): DatabasePool => {
        const { db, sql, close } = createDatabase({ url: environment.DATABASE_URL });
        return { db, sql, close };
      },
    },
    {
      provide: DATABASE,
      inject: [DATABASE_POOL],
      useFactory: (pool: DatabasePool): Database => pool.db,
    },
  ],
  exports: [DATABASE, DATABASE_POOL],
})
export class DatabaseModule {}
