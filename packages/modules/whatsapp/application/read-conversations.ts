import type { WhatsAppConversations, WhatsAppThread } from '@amc/contracts';
import type { Clock } from '@amc/kernel';
import { scopeFor } from '../domain/index.js';
import type { CallerLike, ConversationReader } from './ports.js';

/**
 * The conversations screen and one thread (PW-08).
 *
 * Scoped rather than permission-guarded, for the reason every read in this
 * system is: `clients.view.all` and `clients.view.assigned` are held by
 * different roles, so naming either one on the route locks the other out. What
 * the caller may see is decided by the scope, and an empty list is a real
 * answer.
 */
export class ReadConversations {
  constructor(
    private readonly reader: ConversationReader,
    private readonly clock: Clock,
  ) {}

  async list(caller: CallerLike): Promise<WhatsAppConversations> {
    const conversations = await this.reader.list(scopeFor(caller), this.clock.now());
    return { conversations };
  }

  /** One thread, or nothing — which is also the answer for one out of scope. */
  async thread(caller: CallerLike, id: string): Promise<WhatsAppThread | null> {
    return this.reader.thread(id, scopeFor(caller), this.clock.now());
  }
}
