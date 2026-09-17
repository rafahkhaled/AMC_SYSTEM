import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ClientScope } from '../domain/access.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/**
 * Whether a caller may reach a client at all.
 *
 * One implementation, used by every repository that hangs rows off a client.
 * It was written out twice, in the vault and the contact log, and a third
 * copy was about to appear — at which point one of them would eventually be
 * fixed and the others not.
 *
 * Parameterised rather than interpolated. A client id is a value, and
 * building SQL by concatenation is how a value becomes a statement.
 */
export async function clientIsReachable(
  db: Db,
  clientId: string,
  scope: ClientScope,
): Promise<boolean> {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'none') return false;

  const rows = await db.execute<{ ok: boolean }>(sql`
    SELECT true AS ok FROM client_staff_access
    WHERE client_id = ${clientId} AND user_id = ${scope.userId}
    LIMIT 1
  `);
  return rows.length > 0;
}

/** The same rule as a SQL fragment. Re-exported; the definition lives in `@amc/database`. */
export { scopePredicate as visibleToScope } from '@amc/database';
