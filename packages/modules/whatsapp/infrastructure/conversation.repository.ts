import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ConversationRepository, MessageRepository } from '../application/ports.js';
import {
  Conversation,
  type ConversationScope,
  type Handling,
  type Language,
  Message,
  type MessageKind,
} from '../domain/index.js';
import { whatsappConversations, whatsappMessages } from './schema.js';
import { conversationsVisibleTo } from './visibility.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

function toConversation(row: typeof whatsappConversations.$inferSelect): Conversation {
  return Conversation.rehydrate({
    id: row.id,
    phone: row.phone,
    clientId: row.clientId,
    contactId: row.contactId,
    profileName: row.profileName,
    language: row.language as Language,
    handling: row.handling as Handling,
    assignedUserId: row.assignedUserId,
    awaiting: (row.awaiting as 'menu_choice' | 'documents' | null) ?? null,
    unclearStreak: row.unclearStreak,
    optedOutAt: row.optedOutAt,
    lastInboundAt: row.lastInboundAt,
    lastOutboundAt: row.lastOutboundAt,
    createdAt: row.createdAt,
  });
}

export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly db: Db) {}

  async findByPhone(phone: string): Promise<Conversation | null> {
    const [row] = await this.db
      .select()
      .from(whatsappConversations)
      .where(eq(whatsappConversations.phone, phone))
      .limit(1);
    return row ? toConversation(row) : null;
  }

  async findById(id: string): Promise<Conversation | null> {
    const [row] = await this.db
      .select()
      .from(whatsappConversations)
      .where(eq(whatsappConversations.id, id))
      .limit(1);
    return row ? toConversation(row) : null;
  }

  /**
   * The same conversation, but only if this scope may reach it.
   *
   * Separate from `findById` rather than a scope argument on it, because the
   * webhook genuinely has no caller — a message from a client arrives with
   * nobody signed in — and an optional scope argument is one somebody forgets
   * to pass. Every path that acts on behalf of a person uses this one.
   *
   * Out of scope answers the same as not there. Telling somebody a
   * conversation exists but is not theirs is itself the thing being withheld.
   */
  async findVisible(id: string, scope: ConversationScope): Promise<Conversation | null> {
    if (scope.kind === 'none') return null;

    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT c.id FROM whatsapp_conversations c
      WHERE c.id = ${id} AND ${conversationsVisibleTo(scope)}
      LIMIT 1
    `);
    return rows[0] ? this.findById(id) : null;
  }

  /**
   * Writes the conversation, inserting or updating.
   *
   * On conflict of the phone number rather than the id, because two webhook
   * deliveries for the same new number can arrive close enough together to both
   * find nothing and both insert. Meta delivers concurrently and does not wait
   * for one to finish; without this the second one fails on the unique index and
   * the client's first message is the one that gets lost.
   */
  async save(conversation: Conversation): Promise<void> {
    const state = conversation.snapshot();
    const values = {
      id: state.id,
      phone: state.phone,
      clientId: state.clientId,
      contactId: state.contactId,
      profileName: state.profileName,
      language: state.language,
      handling: state.handling,
      assignedUserId: state.assignedUserId,
      awaiting: state.awaiting,
      unclearStreak: state.unclearStreak,
      optedOutAt: state.optedOutAt,
      lastInboundAt: state.lastInboundAt,
      lastOutboundAt: state.lastOutboundAt,
      createdAt: state.createdAt,
    };

    await this.db
      .insert(whatsappConversations)
      .values(values)
      .onConflictDoUpdate({
        target: whatsappConversations.phone,
        set: {
          clientId: values.clientId,
          contactId: values.contactId,
          profileName: values.profileName,
          language: values.language,
          handling: values.handling,
          assignedUserId: values.assignedUserId,
          awaiting: values.awaiting,
          unclearStreak: values.unclearStreak,
          optedOutAt: values.optedOutAt,
          lastInboundAt: values.lastInboundAt,
          lastOutboundAt: values.lastOutboundAt,
        },
      });
  }
}

function toMessage(row: typeof whatsappMessages.$inferSelect): Message {
  return Message.rehydrate({
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction as 'inbound' | 'outbound',
    providerMessageId: row.providerMessageId,
    kind: row.kind as MessageKind,
    body: row.body,
    templateName: row.templateName,
    mediaId: row.mediaId,
    mediaMimeType: row.mediaMimeType,
    mediaFilename: row.mediaFilename,
    documentId: row.documentId,
    status: row.status as ReturnType<Message['snapshot']>['status'],
    failureReason: row.failureReason,
    sentByUserId: row.sentByUserId,
    contactLogEntryId: row.contactLogEntryId,
    occurredAt: row.occurredAt,
  });
}

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly db: Db) {}

  /**
   * Stores it, or says the database already had this message.
   *
   * The duplicate is detected by the unique index on Meta's own id rather than
   * by looking first: Meta retries a delivery it believes failed, and two
   * retries arriving at once would both find nothing and both insert. The index
   * is the only thing that can decide this, and `DO NOTHING` returning no rows
   * is how it says so.
   */
  async store(message: Message): Promise<'stored' | 'already_had_it'> {
    const state = message.snapshot();
    const inserted = await this.db
      .insert(whatsappMessages)
      .values({
        id: state.id,
        conversationId: state.conversationId,
        direction: state.direction,
        providerMessageId: state.providerMessageId,
        kind: state.kind,
        body: state.body,
        templateName: state.templateName,
        mediaId: state.mediaId,
        mediaMimeType: state.mediaMimeType,
        mediaFilename: state.mediaFilename,
        documentId: state.documentId,
        status: state.status,
        failureReason: state.failureReason,
        sentByUserId: state.sentByUserId,
        contactLogEntryId: state.contactLogEntryId,
        occurredAt: state.occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: whatsappMessages.id });

    return inserted.length > 0 ? 'stored' : 'already_had_it';
  }

  async save(message: Message): Promise<void> {
    const state = message.snapshot();
    await this.db
      .update(whatsappMessages)
      .set({
        providerMessageId: state.providerMessageId,
        status: state.status,
        failureReason: state.failureReason,
        documentId: state.documentId,
        contactLogEntryId: state.contactLogEntryId,
      })
      .where(eq(whatsappMessages.id, state.id));
  }

  async findByProviderId(providerMessageId: string): Promise<Message | null> {
    const [row] = await this.db
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.providerMessageId, providerMessageId),
          isNotNull(whatsappMessages.providerMessageId),
        ),
      )
      .limit(1);
    return row ? toMessage(row) : null;
  }

  /** The thread, oldest first, limited to the last `limit` messages. */
  async thread(conversationId: string, limit: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.conversationId, conversationId))
      .orderBy(desc(whatsappMessages.occurredAt), desc(whatsappMessages.id))
      .limit(limit);
    return rows.reverse().map(toMessage);
  }

  /**
   * Stores the payload Meta sent, separately from the message itself.
   *
   * Separate because the message is stored through the domain object, which has
   * no business carrying a provider's JSON, and because a `raw` column that
   * were part of the insert would make the duplicate check above depend on it.
   */
  async keepRaw(messageId: string, raw: unknown): Promise<void> {
    if (raw === undefined) return;
    await this.db
      .update(whatsappMessages)
      .set({ raw: raw as Record<string, unknown> })
      .where(eq(whatsappMessages.id, messageId));
  }

  /** How many of the client's messages arrived after our last reply. */
  async unreadCounts(): Promise<Map<string, number>> {
    const rows = await this.db.execute<{ conversation_id: string; unread: string }>(sql`
      SELECT m.conversation_id, count(*)::text AS unread
      FROM whatsapp_messages m
      JOIN whatsapp_conversations c ON c.id = m.conversation_id
      WHERE m.direction = 'inbound'
        AND (c.last_outbound_at IS NULL OR m.occurred_at > c.last_outbound_at)
      GROUP BY m.conversation_id
    `);
    return new Map(rows.map((row) => [row.conversation_id, Number(row.unread)]));
  }
}
