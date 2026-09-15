import { appliedMigrations } from '@amc/database';
import type { DatabasePool } from '../persistence/database.module.js';
import type { ReadinessCheck } from './health.controller.js';

/**
 * Not ready is not the same as not alive.
 *
 * This answers two questions at once: can Postgres be reached, and has the
 * schema this build expects actually been applied? The second matters because
 * a deploy that starts before its migration lands looks perfectly healthy
 * until the first request touches a missing table, which is how a user ends up
 * being the one who discovers it.
 */
export function databaseReadiness(pool: DatabasePool): ReadinessCheck {
  return {
    name: 'database',
    async check() {
      const applied = await appliedMigrations(pool.sql);
      if (applied.length === 0) {
        return { healthy: false, detail: 'connected, but no migrations applied' };
      }
      const latest = applied[applied.length - 1];
      return { healthy: true, detail: `${applied.length} migrations, latest ${latest?.filename}` };
    },
  };
}
