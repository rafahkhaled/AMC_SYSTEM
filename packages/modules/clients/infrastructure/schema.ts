import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

/** Case-insensitive, so one email address cannot become two contacts. */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const clients = pgTable(
  'clients',
  {
    id: text('id').primaryKey(),
    legalName: text('legal_name').notNull(),
    legalNameArabic: text('legal_name_arabic'),
    tradeLicenceNumber: text('trade_licence_number'),
    status: text('status').notNull().default('active'),

    vatState: text('vat_state').notNull().default('not_registered'),
    vatTrn: text('vat_trn'),
    vatRegisteredOn: date('vat_registered_on'),
    vatDeregisteredOn: date('vat_deregistered_on'),
    vatFrequency: text('vat_frequency'),
    vatAnchorEndMonth: smallint('vat_anchor_end_month'),

    ctState: text('ct_state').notNull().default('not_registered'),
    ctTrn: text('ct_trn'),
    ctRegisteredOn: date('ct_registered_on'),
    ctDeregisteredOn: date('ct_deregistered_on'),
    financialYearEndMonth: smallint('financial_year_end_month'),

    onboardedOn: timestamp('onboarded_on', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('clients_status_idx').on(table.status)],
);

export const clientRates = pgTable(
  'client_rates',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    // Whole fils. Bigint because a number of minor units outgrows an integer
    // sooner than people expect once amounts are annual.
    perHourMinor: bigint('per_hour_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('AED'),
    effectiveFrom: date('effective_from').notNull(),
    changedBy: text('changed_by').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('client_rates_one_per_day').on(table.clientId, table.effectiveFrom)],
);

export const leads = pgTable(
  'leads',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    phone: text('phone'),
    email: citext('email'),
    source: text('source').notNull(),
    sourceDetail: text('source_detail'),
    requestedService: text('requested_service'),
    status: text('status').notNull().default('new'),
    convertedClientId: text('converted_client_id').references(() => clients.id, {
      onDelete: 'set null',
    }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('leads_status_idx').on(table.status, table.receivedAt)],
);

export const clientContacts = pgTable(
  'client_contacts',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    name: text('name').notNull(),
    role: text('role'),
    phone: text('phone'),
    email: citext('email'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('client_contacts_client_idx').on(table.clientId)],
);

/** The table every scoped read joins against. */
export const clientStaffAccess = pgTable(
  'client_staff_access',
  {
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: text('assigned_by').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clientId, table.userId] }),
    index('client_staff_access_user_idx').on(table.userId),
  ],
);

export const clientDocuments = pgTable(
  'client_documents',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    label: text('label'),
    status: text('status').notNull().default('required'),
    storageKey: text('storage_key'),
    originalName: text('original_name'),
    checksum: text('checksum'),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on'),
    supersededById: text('superseded_by_id'),
    uploadedBy: text('uploaded_by'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('client_documents_client_idx').on(table.clientId, table.type)],
);

/**
 * Client logins to government portals (FR-05).
 *
 * `secretSealed` is the only place a password exists here, and it is
 * encrypted. There is deliberately no plaintext column, so a careless
 * `select()` cannot put one in a log.
 */
export const clientCredentials = pgTable('client_credentials', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(),
  kind: text('kind').notNull(),
  username: text('username').notNull(),
  secretSealed: text('secret_sealed').notNull(),
  note: text('note'),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  retiredBy: text('retired_by'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Conversations with a client (FR-06). */
export const clientContactLog = pgTable('client_contact_log', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(),
  contactId: text('contact_id'),
  userId: text('user_id'),
  channel: text('channel').notNull(),
  direction: text('direction').notNull(),
  happenedAt: timestamp('happened_at', { withTimezone: true }).notNull(),
  summary: text('summary').notNull(),
  taskId: text('task_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Screenshots of those conversations. The file lives in storage; this is the key. */
export const contactLogAttachments = pgTable('contact_log_attachments', {
  id: text('id').primaryKey(),
  entryId: text('entry_id').notNull(),
  storageKey: text('storage_key').notNull(),
  originalName: text('original_name').notNull(),
  contentType: text('content_type').notNull(),
  checksum: text('checksum').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
