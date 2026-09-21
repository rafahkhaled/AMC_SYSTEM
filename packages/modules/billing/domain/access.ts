import { type CallerLike, heldBy } from '@amc/kernel';

/**
 * Who may see which statements and invoices.
 *
 * Its own type rather than an import of the clients module's `ClientScope`,
 * because a scope means something different in each module and shapes that
 * merely look alike are how one drifts into the other. What it decides here is
 * narrower: every statement belongs to exactly one client, so there is no
 * unattached case to think about.
 */
export type BillingScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'assigned'; readonly userId: string }
  | { readonly kind: 'none' };

/**
 * Derived from the *client* permissions, not from `billing.view`.
 *
 * `billing.view` answers a different question — may this person open the
 * billing screens at all — and both the manager and an accountant hold it.
 * Which clients they each see inside those screens is the client scope, and
 * the SRS's role table is the authority on that. Deriving it from anything
 * else would give somebody a second way into a client file that nobody
 * thought to check.
 */
export function scopeFor(caller: Pick<CallerLike, 'userId' | 'permissions'>): BillingScope {
  const held = heldBy(caller);
  if (held.has('clients.view.all')) return { kind: 'all' };
  if (held.has('clients.view.assigned')) return { kind: 'assigned', userId: caller.userId };
  return { kind: 'none' };
}

/** Raising a bill is a manager's act, not an accountant's. */
export function mayInvoice(caller: Pick<CallerLike, 'permissions'>): boolean {
  return heldBy(caller).has('billing.invoice.issue');
}
