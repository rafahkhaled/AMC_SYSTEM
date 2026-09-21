import { type CallerLike, heldBy } from '@amc/kernel';

/**
 * Who may see which conversations.
 *
 * Its own type rather than an import of `ClientScope`, because it answers a
 * different question. A client scope decides which clients somebody may read;
 * this decides which conversations, and a conversation may belong to no client
 * at all — which is the case the two shapes disagree about and the reason
 * borrowing the other module's type would be wrong even though it looks
 * identical.
 *
 * An unmatched conversation is visible to whoever can see every client, and to
 * the person it was handed to. It is deliberately *not* visible to every
 * accountant: until somebody says whose number it is, it might be anybody's
 * client, and a stranger's first message can contain anything.
 */
export type ConversationScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'assigned'; readonly userId: string }
  | { readonly kind: 'none' };

export const ALL_CONVERSATIONS: ConversationScope = { kind: 'all' };
export const NO_CONVERSATIONS: ConversationScope = { kind: 'none' };

/**
 * Derives the scope from what the caller may do.
 *
 * It reads the client permissions rather than WhatsApp ones of its own. The
 * SRS's role table is the authority on who may see a client's affairs, and a
 * conversation with a client is their affairs; inventing `whatsapp.view` here
 * would put the code out of step with the document it is built from, and give
 * somebody a way to read a client file through a channel nobody thought to
 * check.
 */
export function scopeFor(caller: Pick<CallerLike, 'userId' | 'permissions'>): ConversationScope {
  const held = heldBy(caller);
  if (held.has('clients.view.all')) return ALL_CONVERSATIONS;
  if (held.has('clients.view.assigned')) return { kind: 'assigned', userId: caller.userId };
  return NO_CONVERSATIONS;
}

/** Whether the caller may write to a client on the practice's behalf. */
export function mayWrite(caller: Pick<CallerLike, 'permissions'>): boolean {
  return heldBy(caller).has('clients.edit');
}
