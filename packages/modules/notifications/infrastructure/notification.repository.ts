import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { NotificationRepository, PreferenceRepository } from '../application/ports.js';
import {
  type Delivery,
  Notification,
  type NotificationKind,
  isNotificationKind,
} from '../domain/index.js';
import { notificationPreferences, notifications } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

function toAggregate(row: typeof notifications.$inferSelect): Notification {
  return Notification.rehydrate({
    id: row.id,
    userId: row.userId,
    kind: row.kind as NotificationKind,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    clientId: row.clientId,
    wording: {
      titleEn: row.titleEn,
      titleAr: row.titleAr,
      bodyEn: row.bodyEn,
      bodyAr: row.bodyAr,
    },
    readAt: row.readAt,
    emailedAt: row.emailedAt,
    createdAt: row.createdAt,
  });
}

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Db) {}

  async forUser(
    userId: string,
    options: { limit?: number; unreadOnly?: boolean } = {},
  ): Promise<Notification[]> {
    const where = options.unreadOnly
      ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
      : eq(notifications.userId, userId);

    const rows = await this.db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(options.limit ?? 50);

    return rows.map(toAggregate);
  }

  async findById(id: string, userId: string): Promise<Notification | null> {
    const [row] = await this.db
      .select()
      .from(notifications)
      // Scoped by the owner in the query, not checked afterwards. Somebody
      // else's notification reads as not found, which is what it should be.
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .limit(1);

    return row ? toAggregate(row) : null;
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM notifications
      WHERE user_id = ${userId} AND read_at IS NULL
    `);
    return Number(row?.count ?? 0);
  }

  /**
   * Stores it, and says whether it was new.
   *
   * The uniqueness lives in the database, so a sweep does not have to remember
   * what it did yesterday. `DO NOTHING` returning no row is how the caller
   * learns not to send a second email.
   */
  async raise(notification: Notification): Promise<boolean> {
    const state = notification.snapshot();
    const inserted = await this.db
      .insert(notifications)
      .values({
        id: state.id,
        userId: state.userId,
        kind: state.kind,
        subjectType: state.subjectType,
        subjectId: state.subjectId,
        clientId: state.clientId,
        titleEn: state.wording.titleEn,
        titleAr: state.wording.titleAr,
        bodyEn: state.wording.bodyEn,
        bodyAr: state.wording.bodyAr,
        createdAt: state.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });

    return inserted.length > 0;
  }

  async save(notification: Notification): Promise<void> {
    const state = notification.snapshot();
    await this.db
      .update(notifications)
      .set({ readAt: state.readAt, emailedAt: state.emailedAt })
      .where(eq(notifications.id, state.id));
  }

  async markAllRead(userId: string, now: Date): Promise<number> {
    const updated = await this.db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });

    return updated.length;
  }
}

export class DrizzlePreferenceRepository implements PreferenceRepository {
  constructor(private readonly db: Db) {}

  async forUser(userId: string): Promise<Map<NotificationKind, Delivery>> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));

    const chosen = new Map<NotificationKind, Delivery>();
    for (const row of rows) {
      // A row for a kind this version no longer has is ignored rather than
      // crashing somebody's settings screen.
      if (isNotificationKind(row.kind)) {
        chosen.set(row.kind, { inApp: row.inApp, email: row.email });
      }
    }
    return chosen;
  }

  async set(userId: string, kind: NotificationKind, delivery: Delivery): Promise<void> {
    const row = { userId, kind, inApp: delivery.inApp, email: delivery.email };
    await this.db
      .insert(notificationPreferences)
      .values(row)
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.kind],
        set: { inApp: row.inApp, email: row.email },
      });
  }
}
