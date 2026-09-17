import { boolean, index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    clientId: text('client_id'),
    titleEn: text('title_en').notNull(),
    titleAr: text('title_ar').notNull(),
    bodyEn: text('body_en').notNull(),
    bodyAr: text('body_ar').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notifications_user_idx').on(table.userId, table.createdAt)],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    inApp: boolean('in_app').notNull().default(true),
    email: boolean('email').notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.userId, table.kind] })],
);
