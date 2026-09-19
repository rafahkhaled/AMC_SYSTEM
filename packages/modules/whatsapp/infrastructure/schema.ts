import { index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const whatsappConversations = pgTable(
  'whatsapp_conversations',
  {
    id: text('id').primaryKey(),
    phone: text('phone_e164').notNull(),
    clientId: text('client_id'),
    contactId: text('contact_id'),
    profileName: text('profile_name'),
    language: text('language').notNull().default('ar'),
    handling: text('handling').notNull().default('bot'),
    assignedUserId: text('assigned_user_id'),
    awaiting: text('awaiting'),
    unclearStreak: smallint('unclear_streak').notNull().default(0),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('whatsapp_conversations_phone_key').on(table.phone),
    index('whatsapp_conversations_queue_idx').on(table.handling, table.lastInboundAt),
  ],
);

export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    direction: text('direction').notNull(),
    providerMessageId: text('provider_message_id'),
    kind: text('kind').notNull(),
    body: text('body'),
    templateName: text('template_name'),
    mediaId: text('media_id'),
    mediaMimeType: text('media_mime_type'),
    mediaFilename: text('media_filename'),
    documentId: text('document_id'),
    status: text('status').notNull(),
    failureReason: text('failure_reason'),
    sentByUserId: text('sent_by_user_id'),
    contactLogEntryId: text('contact_log_entry_id'),
    raw: jsonb('raw'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('whatsapp_messages_conversation_idx').on(table.conversationId, table.occurredAt),
  ],
);
