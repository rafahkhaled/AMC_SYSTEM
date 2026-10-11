import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Whether a value is on one of the lists an administrator maintains.
 *
 * Structurally the kernel's `ReferenceLookup`, which the use cases ask. It is
 * here, beside the table it reads, so the API and the integration tests use the
 * one implementation: a test double that said yes to everything would prove
 * nothing about a list that says no.
 *
 * Read from the table every time rather than cached. An option added from
 * Settings has to be usable on the very next request, and one just retired has
 * to stop being accepted on it; a cache is how "I added it and it still says
 * no" becomes a support call.
 */
export function referenceLookup(db: PostgresJsDatabase<Record<string, unknown>>): {
  isLive(list: string, code: string): Promise<boolean>;
} {
  return {
    async isLive(list, code) {
      const rows = await db.execute<{ one: number }>(sql`
        SELECT 1 AS one FROM reference_options
        WHERE list = ${list} AND code = ${code} AND retired_at IS NULL
      `);
      return rows.length > 0;
    },
  };
}
