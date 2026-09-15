import type { EventCollector } from '@amc/kernel';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DocumentRepository, ExpiringDocument } from '../application/ports.js';
import {
  ClientDocument,
  type ClientId,
  type ClientScope,
  type DocumentId,
  type DocumentStatus,
  type DocumentTypeCode,
} from '../domain/index.js';
import { clientDocuments, clientStaffAccess, clients } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

const asDate = (value: string | null): Date | null =>
  value ? new Date(`${value}T00:00:00Z`) : null;
const asColumn = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(
    private readonly db: Db,
    private readonly collector?: EventCollector,
  ) {}

  /**
   * Scoped through the client that owns it. A document is only ever reachable
   * by someone who may see the client, which is checked here rather than left
   * to the caller to remember.
   */
  async findById(id: DocumentId, scope: ClientScope): Promise<ClientDocument | null> {
    if (scope.kind === 'none') return null;

    const [row] = await this.db
      .select({ document: clientDocuments })
      .from(clientDocuments)
      .innerJoin(clients, eq(clients.id, clientDocuments.clientId))
      .where(and(eq(clientDocuments.id, id), this.visibleTo(scope)))
      .limit(1);

    return row ? toAggregate(row.document) : null;
  }

  async currentFor(clientId: ClientId, scope: ClientScope): Promise<ClientDocument[]> {
    if (scope.kind === 'none') return [];

    const rows = await this.db
      .select({ document: clientDocuments })
      .from(clientDocuments)
      .innerJoin(clients, eq(clients.id, clientDocuments.clientId))
      .where(
        and(
          eq(clientDocuments.clientId, clientId),
          // Superseded versions are history, not the current file.
          isNull(clientDocuments.supersededById),
          this.visibleTo(scope),
        ),
      );

    return rows.map((row) => toAggregate(row.document));
  }

  async expiringOn(days: number, today: Date): Promise<ExpiringDocument[]> {
    const target = new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);

    const rows = await this.db
      .select({
        documentId: clientDocuments.id,
        clientId: clientDocuments.clientId,
        clientName: clients.legalName,
        type: clientDocuments.type,
        expiresOn: clientDocuments.expiresOn,
      })
      .from(clientDocuments)
      .innerJoin(clients, eq(clients.id, clientDocuments.clientId))
      .where(
        and(
          eq(clientDocuments.expiresOn, target),
          isNull(clientDocuments.supersededById),
          // A document already being renewed is not chased. Chasing one is how
          // a client learns to ignore the reminders.
          eq(clientDocuments.status, 'held'),
        ),
      );

    return rows.map((row) => ({
      documentId: row.documentId,
      clientId: row.clientId,
      clientName: row.clientName,
      type: row.type as DocumentTypeCode,
      expiresOn: new Date(`${row.expiresOn}T00:00:00Z`),
      daysRemaining: days,
    }));
  }

  async save(document: ClientDocument): Promise<void> {
    this.collector?.collect(document.pullEvents());
    const state = document.snapshot();

    const row = {
      id: state.id,
      clientId: state.clientId,
      type: state.type,
      label: state.label,
      status: state.status,
      storageKey: state.storageKey,
      originalName: state.originalName,
      checksum: state.checksum,
      issuedOn: asColumn(state.issuedOn),
      expiresOn: asColumn(state.expiresOn),
      supersededById: state.supersededById,
      uploadedBy: state.uploadedBy,
      uploadedAt: state.uploadedAt,
      requestedAt: state.requestedAt,
    };

    await this.db
      .insert(clientDocuments)
      .values(row)
      .onConflictDoUpdate({ target: clientDocuments.id, set: row });
  }

  private visibleTo(scope: ClientScope) {
    if (scope.kind === 'all') return undefined;
    if (scope.kind === 'none') return sql`false`;
    return sql`EXISTS (
      SELECT 1 FROM ${clientStaffAccess}
      WHERE ${clientStaffAccess.clientId} = ${clients.id}
        AND ${clientStaffAccess.userId} = ${scope.userId}
    )`;
  }
}

function toAggregate(row: typeof clientDocuments.$inferSelect): ClientDocument {
  return ClientDocument.rehydrate({
    id: row.id,
    clientId: row.clientId,
    type: row.type as DocumentTypeCode,
    label: row.label,
    status: row.status as DocumentStatus,
    storageKey: row.storageKey,
    originalName: row.originalName,
    checksum: row.checksum,
    issuedOn: asDate(row.issuedOn),
    expiresOn: asDate(row.expiresOn),
    supersededById: row.supersededById,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt,
    requestedAt: row.requestedAt,
  });
}
