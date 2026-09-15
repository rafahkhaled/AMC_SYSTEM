import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Case-insensitive text. Two spellings of one email address must never become
 * two accounts, and the database is the only place that can promise it.
 */
const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: citext('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: text('status').notNull().default('active'),
    totpSecret: text('totp_secret'),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('users_status_idx').on(table.status)],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.role] })],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Only the hash of the secret is stored, never the secret itself.
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    idleMinutes: integer('idle_minutes').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    twoFactorPassed: boolean('two_factor_passed').notNull().default(false),
  },
  (table) => [
    index('sessions_user_idx').on(table.userId),
    index('sessions_absolute_expiry_idx').on(table.absoluteExpiresAt),
  ],
);
