import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: text('actor_user_id'),
    actorRoles: text('actor_roles').array().notNull().default([]),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    ipAddress: text('ip_address'),
    requestId: text('request_id'),
    sessionId: text('session_id'),
  },
  (table) => [
    index('audit_log_entity_idx').on(table.entityType, table.entityId, table.occurredAt),
    index('audit_log_actor_idx').on(table.actorUserId, table.occurredAt),
  ],
);

export const outbox = pgTable('outbox', {
  id: text('id').primaryKey(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  name: text('name').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  payload: jsonb('payload').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
});
