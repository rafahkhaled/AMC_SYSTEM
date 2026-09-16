import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ContactLogRepository } from '../application/ports.js';
import type { ClientScope } from '../domain/access.js';
import {
  type ContactAttachment,
  type ContactChannel,
  type ContactDirection,
  ContactLogEntry,
} from '../domain/contact-log.js';
import { clientContactLog, contactLogAttachments } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

export class DrizzleContactLogRepository implements ContactLogRepository {
  constructor(private readonly db: Db) {}

  async forClient(clientId: string, scope: ClientScope): Promise<ContactLogEntry[]> {
    if (!(await this.reachable(clientId, scope))) return [];

    const rows = await this.db
      .select()
      .from(clientContactLog)
      .where(eq(clientContactLog.clientId, clientId))
      .orderBy(desc(clientContactLog.happenedAt));

    if (rows.length === 0) return [];

    /*
     * One query for every attachment on the page rather than one per entry.
     * A client with a year of chasing has hundreds of entries, and a query
     * each is how a page that was fine in testing becomes unusable in March.
     */
    const files = await this.db
      .select()
      .from(contactLogAttachments)
      .where(
        inArray(
          contactLogAttachments.entryId,
          rows.map((row) => row.id),
        ),
      );

    const byEntry = new Map<string, ContactAttachment[]>();
    for (const file of files) {
      const list = byEntry.get(file.entryId) ?? [];
      list.push({
        id: file.id,
        storageKey: file.storageKey,
        originalName: file.originalName,
        contentType: file.contentType,
        checksum: file.checksum,
        sizeBytes: file.sizeBytes,
      });
      byEntry.set(file.entryId, list);
    }

    return rows.map((row) =>
      ContactLogEntry.rehydrate({
        id: row.id,
        clientId: row.clientId,
        contactId: row.contactId,
        userId: row.userId,
        channel: row.channel as ContactChannel,
        direction: row.direction as ContactDirection,
        happenedAt: row.happenedAt,
        summary: row.summary,
        taskId: row.taskId,
        attachments: byEntry.get(row.id) ?? [],
        createdAt: row.createdAt,
      }),
    );
  }

  async save(entry: ContactLogEntry): Promise<void> {
    const state = entry.snapshot();
    const row = {
      id: state.id,
      clientId: state.clientId,
      contactId: state.contactId,
      userId: state.userId,
      channel: state.channel,
      direction: state.direction,
      happenedAt: state.happenedAt,
      summary: state.summary,
      taskId: state.taskId,
    };
    await this.db
      .insert(clientContactLog)
      .values(row)
      .onConflictDoUpdate({ target: clientContactLog.id, set: row });

    for (const attachment of state.attachments) {
      await this.db
        .insert(contactLogAttachments)
        .values({
          id: attachment.id,
          entryId: state.id,
          storageKey: attachment.storageKey,
          originalName: attachment.originalName,
          contentType: attachment.contentType,
          checksum: attachment.checksum,
          sizeBytes: attachment.sizeBytes,
        })
        .onConflictDoNothing({ target: contactLogAttachments.id });
    }
  }

  /** Decided here rather than above, so a caller cannot skip it. */
  private async reachable(clientId: string, scope: ClientScope): Promise<boolean> {
    if (scope.kind === 'all') return true;
    if (scope.kind === 'none') return false;

    const rows = await this.db.execute<{ ok: boolean }>(sql`
      SELECT true AS ok FROM client_staff_access
      WHERE client_id = ${clientId} AND user_id = ${scope.userId}
      LIMIT 1
    `);
    return rows.length > 0;
  }
}
