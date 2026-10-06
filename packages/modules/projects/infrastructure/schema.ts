import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const clientServices = pgTable('client_services', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(),
  service: text('service').notNull(),
  activeFrom: date('active_from').notNull(),
  activeTo: date('active_to'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    clientServiceId: text('client_service_id').notNull(),
    clientId: text('client_id').notNull(),
    service: text('service').notNull(),
    periodKey: text('period_key'),
    state: text('state').notNull().default('awaiting_documents'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('projects_client_idx').on(table.clientId, table.state)],
);

/** The join that makes a project the link between a client and their documents. */
export const projectDocuments = pgTable(
  'project_documents',
  {
    projectId: text('project_id').notNull(),
    type: text('type').notNull(),
    mandatory: boolean('mandatory').notNull().default(true),
    documentId: text('document_id'),
    attachedAt: timestamp('attached_at', { withTimezone: true }),
    attachedBy: text('attached_by'),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.type] })],
);

export const tasks = pgTable(
  'tasks',
  {
    projectId: text('project_id').notNull(),
    order: integer('order').notNull(),
    dueOn: date('due_on'),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.order] })],
);
