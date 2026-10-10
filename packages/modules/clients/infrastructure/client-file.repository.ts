import type { EventCollector } from '@amc/kernel';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ClientFileRepository, StoredClientFile } from '../application/ports.js';
import type { ClientScope } from '../domain/access.js';
import { ClientFile } from '../domain/client-file.js';
import { clientIsReachable } from './scoping.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/** A type alias, not an interface: `db.execute<T>` wants an index signature. */
type Row = {
  id: string;
  client_id: string;
  storage_key: string;
  original_name: string;
  content_type: string;
  checksum: string;
  size_bytes: string;
  uploaded_by: string;
  uploaded_at: string;
  removed_at: string | null;
  removed_by: string | null;
  uploaded_by_name: string | null;
};

const at = (value: string | null): Date | null => (value === null ? null : new Date(value));

function toFile(row: Row): ClientFile {
  return ClientFile.rehydrate({
    id: row.id,
    clientId: row.client_id,
    storageKey: row.storage_key,
    originalName: row.original_name,
    contentType: row.content_type,
    checksum: row.checksum,
    // bigint comes back from the driver as a string.
    sizeBytes: Number(row.size_bytes),
    uploadedBy: row.uploaded_by,
    uploadedAt: new Date(row.uploaded_at),
    removedAt: at(row.removed_at),
    removedBy: row.removed_by,
  });
}

export class DrizzleClientFileRepository implements ClientFileRepository {
  constructor(
    private readonly db: Db,
    private readonly collector?: EventCollector,
  ) {}

  canReach(clientId: string, scope: ClientScope): Promise<boolean> {
    return clientIsReachable(this.db, clientId, scope);
  }

  async forClient(clientId: string, scope: ClientScope): Promise<StoredClientFile[]> {
    // Asked of the client first, so a folder somebody may not see reads as
    // empty rather than as a count that confirms the client exists.
    if (!(await clientIsReachable(this.db, clientId, scope))) return [];

    const rows = await this.db.execute<Row>(sql`
      SELECT f.*, u.display_name AS uploaded_by_name
      FROM client_files f
      LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.client_id = ${clientId} AND f.removed_at IS NULL
      ORDER BY f.uploaded_at DESC, f.id DESC
    `);
    return rows.map((row) => ({ file: toFile(row), uploadedByName: row.uploaded_by_name }));
  }

  async findById(id: string, scope: ClientScope): Promise<ClientFile | null> {
    const rows = await this.db.execute<Row>(sql`
      SELECT f.*, NULL::text AS uploaded_by_name FROM client_files f WHERE f.id = ${id} LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;
    // A file in a client the caller cannot reach and a file that is not there
    // give the same answer, so an id cannot be used to learn who is a client.
    return (await clientIsReachable(this.db, row.client_id, scope)) ? toFile(row) : null;
  }

  async save(file: ClientFile): Promise<void> {
    this.collector?.collect(file.pullEvents());
    const state = file.snapshot();

    await this.db.execute(sql`
      INSERT INTO client_files
        (id, client_id, storage_key, original_name, content_type, checksum, size_bytes,
         uploaded_by, uploaded_at, removed_at, removed_by)
      VALUES (
        ${state.id}, ${state.clientId}, ${state.storageKey}, ${state.originalName},
        ${state.contentType}, ${state.checksum}, ${state.sizeBytes}, ${state.uploadedBy},
        ${state.uploadedAt.toISOString()}, ${state.removedAt?.toISOString() ?? null},
        ${state.removedBy}
      )
      ON CONFLICT (id) DO UPDATE SET
        removed_at = excluded.removed_at,
        removed_by = excluded.removed_by
    `);
  }
}
