import type { Clock, Conflict, IdGenerator, Result } from '@amc/kernel';
import { ok } from '@amc/kernel';
import type { Conversation, ConversationScope, DeadlineLine, Message } from '../domain/index.js';
import type {
  ContactDirectory,
  ContactLogWriter,
  ConversationRepository,
  DeadlineReader,
  DocumentFiler,
  MessageRepository,
  PracticeIdentity,
  StaffNotifier,
  StaffPicker,
  WhatsAppTransport,
} from './ports.js';

/**
 * Fakes for the use-case tests.
 *
 * They are fakes and not mocks: each one keeps the state a real adapter would
 * keep, so a test can assert on what ended up stored rather than on which method
 * was called with which argument. Assertions about calls pass when the code does
 * the right thing and also when it does it twice.
 */

export class FakeClock implements Clock {
  constructor(private at: Date) {}
  now(): Date {
    return this.at;
  }
  set(at: Date): void {
    this.at = at;
  }
}

export class CountingIds implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `id-${this.n}`;
  }
}

export class InMemoryConversations implements ConversationRepository {
  readonly saved: Conversation[] = [];
  private byPhone = new Map<string, Conversation>();
  private byId = new Map<string, Conversation>();

  async findByPhone(phone: string): Promise<Conversation | null> {
    return this.byPhone.get(phone) ?? null;
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.byId.get(id) ?? null;
  }

  /**
   * The scoped fetch, modelled rather than waved through.
   *
   * A double that ignored the scope would let every access test in this suite
   * pass against a use case that had stopped scoping at all — which is the one
   * thing these tests exist to catch. The rule is the real one: everything for
   * 'all', nothing for 'none', and for an accountant their own clients plus
   * whatever was handed to them personally.
   */
  async findVisible(id: string, scope: ConversationScope): Promise<Conversation | null> {
    if (scope.kind === 'none') return null;
    const conversation = this.byId.get(id);
    if (!conversation) return null;
    if (scope.kind === 'all') return conversation;

    const state = conversation.snapshot();
    if (state.assignedUserId === scope.userId) return conversation;
    if (state.clientId && this.assigned.get(scope.userId)?.has(state.clientId)) {
      return conversation;
    }
    return null;
  }

  /** Which clients an accountant is on, for the scoped fetch above. */
  private assigned = new Map<string, Set<string>>();

  assign(userId: string, clientId: string): void {
    const clients = this.assigned.get(userId) ?? new Set<string>();
    clients.add(clientId);
    this.assigned.set(userId, clients);
  }

  async save(conversation: Conversation): Promise<void> {
    this.byPhone.set(conversation.phone, conversation);
    this.byId.set(conversation.id, conversation);
    this.saved.push(conversation);
  }

  /** The one conversation, for a test that only ever makes one. */
  only(): Conversation {
    const [first] = [...this.byId.values()];
    if (!first) throw new Error('no conversation was created');
    return first;
  }
}

export class InMemoryMessages implements MessageRepository {
  readonly stored: Message[] = [];
  private providerIds = new Set<string>();

  async store(message: Message): Promise<'stored' | 'already_had_it'> {
    const providerId = message.snapshot().providerMessageId;
    if (providerId && this.providerIds.has(providerId)) return 'already_had_it';
    if (providerId) this.providerIds.add(providerId);
    this.stored.push(message);
    return 'stored';
  }

  async save(message: Message): Promise<void> {
    const providerId = message.snapshot().providerMessageId;
    if (providerId) this.providerIds.add(providerId);
    if (!this.stored.includes(message)) this.stored.push(message);
  }

  async findByProviderId(providerMessageId: string): Promise<Message | null> {
    return this.stored.find((m) => m.snapshot().providerMessageId === providerMessageId) ?? null;
  }

  async thread(conversationId: string, limit: number): Promise<Message[]> {
    return this.stored.filter((m) => m.snapshot().conversationId === conversationId).slice(-limit);
  }

  /** What was actually sent to the client, in order. */
  outbound(): string[] {
    return this.stored
      .filter((m) => m.snapshot().direction === 'outbound')
      .map((m) => m.snapshot().body ?? '');
  }
}

export class FakeDirectory implements ContactDirectory {
  private known = new Map<string, Awaited<ReturnType<ContactDirectory['whoseNumber']>>>();

  knows(
    phone: string,
    who: { clientId: string; contactId?: string | null; language?: 'en' | 'ar' | null },
  ): this {
    this.known.set(phone, {
      clientId: who.clientId,
      contactId: who.contactId ?? null,
      contactName: null,
      language: who.language ?? null,
    });
    return this;
  }

  async whoseNumber(phone: string) {
    return this.known.get(phone) ?? null;
  }
}

export class RecordingContactLog implements ContactLogWriter {
  readonly entries: {
    clientId: string;
    direction: 'inbound' | 'outbound';
    summary: string;
  }[] = [];
  private n = 0;

  async record(entry: {
    clientId: string;
    direction: 'inbound' | 'outbound';
    happenedAt: Date;
    summary: string;
    contactId?: string | null;
  }): Promise<string | null> {
    this.entries.push({
      clientId: entry.clientId,
      direction: entry.direction,
      summary: entry.summary,
    });
    this.n += 1;
    return `entry-${this.n}`;
  }
}

export class RecordingFiler implements DocumentFiler {
  readonly filed: { clientId: string; filename: string; bytes: number }[] = [];
  private failure: Conflict | null = null;
  private n = 0;

  willFail(error: Conflict): this {
    this.failure = error;
    return this;
  }

  async file(params: {
    clientId: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<Result<{ documentId: string }, Conflict>> {
    if (this.failure) return { ok: false, error: this.failure };
    this.filed.push({
      clientId: params.clientId,
      filename: params.filename,
      bytes: params.body.byteLength,
    });
    this.n += 1;
    return ok({ documentId: `doc-${this.n}` });
  }
}

export class FakeDeadlines implements DeadlineReader {
  private lines: DeadlineLine[] = [];

  returning(lines: DeadlineLine[]): this {
    this.lines = lines;
    return this;
  }

  async upcomingFor(): Promise<DeadlineLine[]> {
    return this.lines;
  }
}

export class FakeStaff implements StaffPicker {
  constructor(
    private readonly assigned: Record<string, string> = {},
    private readonly duty: string | null = 'u-duty',
  ) {}

  async forClient(clientId: string | null) {
    if (!clientId) return null;
    const userId = this.assigned[clientId];
    return userId ? { userId } : null;
  }

  async onDuty() {
    return this.duty ? { userId: this.duty } : null;
  }
}

export class RecordingNotifier implements StaffNotifier {
  readonly told: { userId: string; said: string }[] = [];
  private throws = false;

  willThrow(): this {
    this.throws = true;
    return this;
  }

  async conversationNeedsYou(params: { userId: string; said: string }): Promise<void> {
    if (this.throws) throw new Error('the notifier is down');
    this.told.push({ userId: params.userId, said: params.said });
  }
}

export class FakeTransport implements WhatsAppTransport {
  readonly sentText: { to: string; body: string }[] = [];
  readonly sentTemplates: { to: string; name: string }[] = [];
  private textFailure: Conflict | null = null;
  private media: { body: Buffer; contentType: string; filename: string | null } | null = {
    body: Buffer.from('a scan of a trade licence'),
    contentType: 'image/jpeg',
    filename: null,
  };
  private mediaFailure: Conflict | null = null;
  private n = 0;

  textWillFail(error: Conflict): this {
    this.textFailure = error;
    return this;
  }

  mediaWillFail(error: Conflict): this {
    this.mediaFailure = error;
    return this;
  }

  holding(media: { body: Buffer; contentType: string; filename: string | null }): this {
    this.media = media;
    return this;
  }

  async sendText(params: { to: string; body: string }) {
    if (this.textFailure) return { ok: false as const, error: this.textFailure };
    this.sentText.push(params);
    this.n += 1;
    return ok({ providerMessageId: `wamid.out.${this.n}` });
  }

  async sendTemplate(params: { to: string; name: string }) {
    this.sentTemplates.push({ to: params.to, name: params.name });
    this.n += 1;
    return ok({ providerMessageId: `wamid.out.${this.n}` });
  }

  async fetchMedia() {
    if (this.mediaFailure || !this.media) {
      return {
        ok: false as const,
        error: this.mediaFailure ?? ({ message: 'nothing held' } as Conflict),
      };
    }
    return ok(this.media);
  }
}

export const PRACTICE: PracticeIdentity = {
  name: { en: 'Active Management Consultancy', ar: 'أكتيف لإدارة الأعمال' },
};
