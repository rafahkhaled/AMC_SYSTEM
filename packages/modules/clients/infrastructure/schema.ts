import {
  bigint,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

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
