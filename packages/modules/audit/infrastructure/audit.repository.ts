import type { Database } from '@amc/database';
import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { AuditQuery, AuditReader, OutboxReader, OutboxRecord } from '../application/ports.js';
import type { AuditEntry } from '../domain/index.js';
import { auditLog, outbox } from './schema.js';

/**
 * Reading only. Nothing in this module writes to the log except the unit of
 * work, and the table refuses updates and deletes outright, so there is no
 * save method here to be tempted by.
 */
export class DrizzleAuditReader implements AuditReader {
  constructor(private readonly db: Database) {}

  async search(query: AuditQuery): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> {
    const conditions = [
      query.entityType ? eq(auditLog.entityType, query.entityType) : undefined,
      query.entityId ? eq(auditLog.entityId, query.entityId) : undefined,
      query.actorUserId ? eq(auditLog.actorUserId, query.actorUserId) : undefined,
      query.action ? eq(auditLog.action, query.action) : undefined,
      query.from ? gte(auditLog.occurredAt, query.from) : undefined,
      query.to ? lte(auditLog.occurredAt, query.to) : undefined,
      // Keyset paging on the timestamp, so a busy log does not shift pages
      // under the reader the way an offset would.
      query.cursor ? lt(auditLog.occurredAt, new Date(query.cursor)) : undefined,
    ].filter((condition) => condition !== undefined);

    const rows = await this.db
      .select()
      .from(auditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const more = rows.length > query.limit;

    return {
      entries: page.map(toEntry),
      nextCursor: more ? (page[page.length - 1]?.occurredAt.toISOString() ?? null) : null,
    };
  }
}

function toEntry(row: typeof auditLog.$inferSelect): AuditEntry {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    actorUserId: row.actorUserId,
    actorRoles: row.actorRoles,
    actorLabel: row.actorLabel,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before as Record<string, unknown> | null,
    after: row.after as Record<string, unknown> | null,
    ipAddress: row.ipAddress,
    requestId: row.requestId,
    sessionId: row.sessionId,
  };
}

/**
 * The outbox drain. Rows are claimed with SKIP LOCKED so that more than one
 * worker can share the table without either waiting on the other or handing
 * the same event to both.
 */
export class DrizzleOutboxReader implements OutboxReader {
  constructor(private readonly db: Database) {}

  async pending(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.db.execute<{
      id: string;
      name: string;
      aggregate_id: string;
      occurred_at: Date;
      payload: unknown;
      attempts: number;
    }>(sql`
      SELECT id, name, aggregate_id, occurred_at, payload, attempts
      FROM outbox
      WHERE published_at IS NULL
      ORDER BY occurred_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);

    return rows.map((row) => ({
      id: row.id,
      attempts: row.attempts,
      event: {
        name: row.name,
        aggregateId: row.aggregate_id,
        occurredAt: row.occurred_at,
        payload: row.payload,
      },
    }));
  }

  async markPublished(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.execute(
      sql`UPDATE outbox SET published_at = ${at} WHERE id = ANY(${sql.raw(`ARRAY['${ids.join("','")}']`)})`,
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db
      .update(outbox)
      .set({ attempts: sql`${outbox.attempts} + 1`, lastError: error.slice(0, 2000) })
      .where(eq(outbox.id, id));
  }
}
