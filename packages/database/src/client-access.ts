import { type SQL, sql } from 'drizzle-orm';

/**
 * Which clients a person is assigned to (SRS 2.2).
 *
 * One definition, here, because four packages need it and they must agree.
 * The clients module owns the table; the services module, the deadline
 * calendar and the API's own read adapters all have to respect it, and none
 * of them may import another module's infrastructure. Written out four times
 * it drifts, and when a scoping rule drifts the failure is somebody reading a
 * client file that is not theirs.
 *
 * `clientIdColumn` is the expression holding the client id in the query being
 * built, because the table it belongs to differs at each call site.
 */
export function assignedClientPredicate(userId: string, clientIdColumn: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM client_staff_access access
    WHERE access.client_id = ${clientIdColumn} AND access.user_id = ${userId}
  )`;
}

/** The three answers a scope can give, as SQL. */
export function scopePredicate(
  scope: { kind: 'all' } | { kind: 'assigned'; userId: string } | { kind: 'none' },
  clientIdColumn: SQL,
): SQL {
  if (scope.kind === 'all') return sql`true`;
  if (scope.kind === 'none') return sql`false`;
  return assignedClientPredicate(scope.userId, clientIdColumn);
}
