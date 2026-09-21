import type { WhatsAppConversationView, WhatsAppMessageView } from '@amc/contracts';
import { formatPhone } from '@amc/kernel';
import { type SQL, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ConversationReader } from '../application/ports.js';
import { type ConversationScope, windowClosesAt, windowStateAt } from '../domain/index.js';
import { conversationsVisibleTo } from './visibility.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/**
 * A timestamp out of raw SQL is a string, not a Date.
 *
 * The driver only maps a column to a Date when the query builder told it what
 * the column is. These queries are raw, so every timestamp arrives as text and
 * a row type that claims `Date` typechecks perfectly and throws
 * `getTime is not a function` the first time a real database answers. Nothing
 * below touches a timestamp without going through here.
 */
function at(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

type ConversationRow = {
  id: string;
  phone_e164: string;
  client_id: string | null;
  client_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  profile_name: string | null;
  language: string;
  handling: string;
  assigned_user_id: string | null;
  assigned_name: string | null;
  opted_out_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  unread: string;
  created_at: string;
};

type MessageRow = {
  id: string;
  direction: string;
  kind: string;
  body: string | null;
  template_name: string | null;
  document_id: string | null;
  media_filename: string | null;
  status: string;
  failure_reason: string | null;
  sent_by_user_id: string | null;
  sent_by_name: string | null;
  occurred_at: string;
};

/**
 * The conversations screen.
 *
 * Raw SQL rather than the query builder, because this is three left joins and a
 * correlated count and the builder's version of that reads worse than the SQL
 * does. The scope predicate is the shared one from `@amc/database`, so this
 * cannot drift from the client repositories — four packages apply it and a
 * drifted scope leaks a client's affairs.
 */
export class DrizzleConversationReader implements ConversationReader {
  constructor(private readonly db: Db) {}

  async list(scope: ConversationScope, now: Date): Promise<WhatsAppConversationView[]> {
    if (scope.kind === 'none') return [];

    const rows = await this.db.execute<ConversationRow>(sql`
      SELECT c.id, c.phone_e164, c.client_id, cl.legal_name AS client_name,
             c.contact_id, k.name AS contact_name, c.profile_name,
             c.language, c.handling, c.assigned_user_id, u.display_name AS assigned_name,
             c.opted_out_at, c.last_inbound_at, c.last_outbound_at, c.created_at,
             coalesce((
               SELECT count(*) FROM whatsapp_messages m
               WHERE m.conversation_id = c.id
                 AND m.direction = 'inbound'
                 AND (c.last_outbound_at IS NULL OR m.occurred_at > c.last_outbound_at)
             ), 0)::text AS unread
      FROM whatsapp_conversations c
      LEFT JOIN clients cl        ON cl.id = c.client_id
      LEFT JOIN client_contacts k ON k.id = c.contact_id
      LEFT JOIN users u           ON u.id = c.assigned_user_id
      WHERE ${this.visible(scope)}
      ORDER BY c.last_inbound_at DESC NULLS LAST, c.created_at DESC
      LIMIT 200
    `);

    return rows.map((row) => toConversationView(row, now));
  }

  async thread(
    id: string,
    scope: ConversationScope,
    now: Date,
  ): Promise<{ conversation: WhatsAppConversationView; messages: WhatsAppMessageView[] } | null> {
    if (scope.kind === 'none') return null;

    const [row] = await this.db.execute<ConversationRow>(sql`
      SELECT c.id, c.phone_e164, c.client_id, cl.legal_name AS client_name,
             c.contact_id, k.name AS contact_name, c.profile_name,
             c.language, c.handling, c.assigned_user_id, u.display_name AS assigned_name,
             c.opted_out_at, c.last_inbound_at, c.last_outbound_at, c.created_at,
             '0'::text AS unread
      FROM whatsapp_conversations c
      LEFT JOIN clients cl        ON cl.id = c.client_id
      LEFT JOIN client_contacts k ON k.id = c.contact_id
      LEFT JOIN users u           ON u.id = c.assigned_user_id
      WHERE c.id = ${id} AND ${this.visible(scope)}
      LIMIT 1
    `);

    // Out of scope and non-existent answer alike. Saying "forbidden" would
    // confirm that a conversation with that id exists.
    if (!row) return null;

    const messages = await this.db.execute<MessageRow>(sql`
      SELECT m.id, m.direction, m.kind, m.body, m.template_name, m.document_id,
             m.media_filename, m.status, m.failure_reason,
             m.sent_by_user_id, u.display_name AS sent_by_name, m.occurred_at
      FROM whatsapp_messages m
      LEFT JOIN users u ON u.id = m.sent_by_user_id
      WHERE m.conversation_id = ${id}
      ORDER BY m.occurred_at, m.id
      LIMIT 500
    `);

    return {
      conversation: toConversationView(row, now),
      messages: messages.map(toMessageView),
    };
  }

  /** The shared predicate, so this cannot drift from the repository. */
  private visible(scope: ConversationScope): SQL {
    return conversationsVisibleTo(scope);
  }
}

function toConversationView(row: ConversationRow, now: Date): WhatsAppConversationView {
  const lastInboundAt = at(row.last_inbound_at);
  return {
    id: row.id,
    phone: row.phone_e164,
    phoneFormatted: formatPhone(row.phone_e164),
    clientId: row.client_id,
    clientName: row.client_name,
    contactId: row.contact_id,
    contactName: row.contact_name,
    profileName: row.profile_name,
    language: row.language === 'en' ? 'en' : 'ar',
    handling: row.handling === 'human' ? 'human' : row.handling === 'closed' ? 'closed' : 'bot',
    assignedUserId: row.assigned_user_id,
    assignedName: row.assigned_name,
    optedOut: row.opted_out_at !== null,
    /*
     * Worked out here rather than in the browser.
     *
     * It is Meta's rule, and the browser reimplementing it would drift — a
     * reply box that says it is open when the server will refuse the send is
     * worse than one that is simply disabled.
     */
    windowOpen: windowStateAt(lastInboundAt, now) === 'open',
    windowClosesAt: windowClosesAt(lastInboundAt)?.toISOString() ?? null,
    lastInboundAt: lastInboundAt?.toISOString() ?? null,
    lastOutboundAt: at(row.last_outbound_at)?.toISOString() ?? null,
    unreadFromClient: Number(row.unread),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toMessageView(row: MessageRow): WhatsAppMessageView {
  return {
    id: row.id,
    direction: row.direction === 'outbound' ? 'outbound' : 'inbound',
    kind: row.kind,
    body: row.body,
    templateName: row.template_name,
    documentId: row.document_id,
    mediaFilename: row.media_filename,
    status: row.status,
    failureReason: row.failure_reason,
    sentByUserId: row.sent_by_user_id,
    sentByName: row.sent_by_name,
    occurredAt: new Date(row.occurred_at).toISOString(),
  };
}
