import { scopePredicate } from '@amc/database';
import { type SQL, sql } from 'drizzle-orm';
import type { ConversationScope } from '../domain/index.js';

/**
 * Which conversations a scope may reach, as a predicate over an aliased table.
 *
 * One definition, used by the reader and by the repository. They ask different
 * questions of it — the reader lists, the repository fetches one to change —
 * and two copies of this is how a screen that correctly hides a conversation
 * ends up beside a route that happily replies to it.
 *
 * `alias` is the table alias in the caller's query, so the same predicate works
 * inside a join and inside a plain select.
 *
 * An unmatched conversation — one attached to no client — is reachable by
 * whoever may see every client, and by the person it was handed to. Not by
 * every accountant: until somebody says whose number it is, a stranger's first
 * message might be anybody's client, and it might be anything.
 */
export function conversationsVisibleTo(scope: ConversationScope, alias = 'c'): SQL {
  if (scope.kind === 'all') return sql`true`;
  if (scope.kind === 'none') return sql`false`;

  const clientId = sql.raw(`${alias}.client_id`);
  const assignedTo = sql.raw(`${alias}.assigned_user_id`);

  return sql`(
    (${clientId} IS NOT NULL AND ${scopePredicate(
      { kind: 'assigned', userId: scope.userId },
      clientId,
    )})
    OR ${assignedTo} = ${scope.userId}
  )`;
}
