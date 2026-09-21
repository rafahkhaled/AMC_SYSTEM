import { scopePredicate } from '@amc/database';
import { type SQL, sql } from 'drizzle-orm';
import type { BillingScope } from '../domain/index.js';

/**
 * Which clients' billing a scope may reach.
 *
 * One definition, used by every read here. The shared `scopePredicate` from
 * `@amc/database` does the work, so this cannot drift from the client
 * repositories — four packages apply it and a drifted scope leaks a client's
 * affairs.
 */
export function billingVisibleTo(scope: BillingScope, clientIdColumn: SQL): SQL {
  if (scope.kind === 'all') return sql`true`;
  if (scope.kind === 'none') return sql`false`;
  return scopePredicate({ kind: 'assigned', userId: scope.userId }, clientIdColumn);
}
