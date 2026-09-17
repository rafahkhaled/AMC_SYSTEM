import type { Actor } from './unit-of-work.js';

/**
 * The authenticated person, as an application use case needs them.
 *
 * Declared once, here, rather than in each module. It lived in four modules'
 * ports files and drifted immediately: two of them wanted only a user id and
 * a permission set, and the two that also wrote audit rows needed the display
 * name — which meant an `Actor` could be built without one, and for a while
 * every task change was logged against nobody.
 *
 * The display name is therefore not optional. A module that only makes an
 * authorisation decision takes `Pick<CallerLike, 'userId' | 'permissions'>`
 * and says so, rather than every caller supplying a name for nothing.
 */
export interface CallerLike {
  readonly userId: string;
  /** A set or a list. Normalise with `heldBy` rather than checking each time. */
  readonly permissions: ReadonlySet<string> | readonly string[];
  readonly roles: readonly string[];
  readonly displayName: string;
  readonly sessionId?: string | undefined;
}

/**
 * What this caller may do, as a set.
 *
 * The HTTP layer hands down a `Set` and tests usually hand down an array. The
 * check was written out at each of ten call sites, which is nine chances to
 * write it differently.
 */
export function heldBy(caller: Pick<CallerLike, 'permissions'>): ReadonlySet<string> {
  return caller.permissions instanceof Set
    ? caller.permissions
    : new Set(caller.permissions as readonly string[]);
}

/**
 * The person, as the audit log needs to name them.
 *
 * One function, because the field that matters is the one easiest to leave
 * out: an `Actor` with no `label` is perfectly valid and produces a log of
 * changes attributed to nobody. That is not hypothetical — see `bugs.md`.
 */
export function actorFrom(caller: CallerLike): Actor {
  return {
    userId: caller.userId,
    roles: caller.roles,
    label: caller.displayName,
    ...(caller.sessionId ? { sessionId: caller.sessionId } : {}),
  };
}
