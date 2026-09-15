/**
 * Who may see which clients (SRS 2.2).
 *
 * This is a value rather than a check scattered through the code, and every
 * read takes one. Making it a required argument is the point: a query that
 * forgets to scope cannot be written, because there is nothing sensible to
 * pass. The alternative, remembering to add a filter, fails exactly once and
 * then silently.
 */
export type ClientScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'assigned'; readonly userId: string }
  | { readonly kind: 'none' };

export const ALL_CLIENTS: ClientScope = { kind: 'all' };
export const NO_CLIENTS: ClientScope = { kind: 'none' };

export function assignedTo(userId: string): ClientScope {
  return { kind: 'assigned', userId };
}

/**
 * Derives the scope from what the caller may do.
 *
 * The manager sees everything, an accountant only their assigned clients, and
 * anyone else nothing. Data entry uploads invoices into batches they are
 * given; they have no business reading a client file.
 */
export function scopeFor(permissions: Iterable<string>, userId: string): ClientScope {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  if (held.has('clients.view.all')) return ALL_CLIENTS;
  if (held.has('clients.view.assigned')) return assignedTo(userId);
  return NO_CLIENTS;
}
