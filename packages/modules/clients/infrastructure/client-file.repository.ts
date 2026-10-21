import type { EventCollector } from '@amc/kernel';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ClientFileRepository, StoredClientFile } from '../application/ports.js';
import type { ClientScope } from '../domain/access.js';
import { ClientFile } from '../domain/client-file.js';
import { ClientFolder } from '../domain/client-folder.js';
import { clientIsReachable } from './scoping.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/** A type alias, not an interface: `db.execute<T>` wants an index signature. */
type Row = {
  id: string;
  client_id: string;
  folder_id: string | null;
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
    folderId: row.folder_id,
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
        (id, client_id, folder_id, storage_key, original_name, content_type, checksum,
         size_bytes, uploaded_by, uploaded_at, removed_at, removed_by)
      VALUES (
        ${state.id}, ${state.clientId}, ${state.folderId}, ${state.storageKey}, ${state.originalName},
        ${state.contentType}, ${state.checksum}, ${state.sizeBytes}, ${state.uploadedBy},
        ${state.uploadedAt.toISOString()}, ${state.removedAt?.toISOString() ?? null},
        ${state.removedBy}
      )
      ON CONFLICT (id) DO UPDATE SET
        folder_id = excluded.folder_id,
        removed_at = excluded.removed_at,
        removed_by = excluded.removed_by
    `);
  }

  async foldersFor(
    clientId: string,
    scope: ClientScope,
  ): Promise<{ folder: ClientFolder; fileCount: number }[]> {
    if (!(await clientIsReachable(this.db, clientId, scope))) return [];
    const rows = await this.db.execute<FolderRow & { file_count: string }>(sql`
      SELECT d.*, (
        SELECT count(*) FROM client_files f
        WHERE f.folder_id = d.id AND f.removed_at IS NULL
      )::text AS file_count
      FROM client_folders d
      WHERE d.client_id = ${clientId} AND d.removed_at IS NULL
      ORDER BY lower(d.name), d.id
    `);
    return rows.map((row) => ({ folder: toFolder(row), fileCount: Number(row.file_count) }));
  }

  async findFolder(id: string, scope: ClientScope): Promise<ClientFolder | null> {
    const rows = await this.db.execute<FolderRow>(
      sql`SELECT * FROM client_folders WHERE id = ${id} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return null;
    return (await clientIsReachable(this.db, row.client_id, scope)) ? toFolder(row) : null;
  }

  /** How many levels down this folder is: 1 for one at the top of the client's folder. */
  async depthOf(folderId: string): Promise<number> {
    const rows = await this.db.execute<{ depth: string }>(sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, 1 AS depth FROM client_folders WHERE id = ${folderId}
        UNION ALL
        SELECT p.id, p.parent_id, chain.depth + 1
        FROM client_folders p JOIN chain ON p.id = chain.parent_id
      )
      SELECT max(depth)::text AS depth FROM chain
    `);
    return Number(rows[0]?.depth ?? 0);
  }

  async nameTaken(
    clientId: string,
    parentId: string | null,
    name: string,
    exceptId?: string,
  ): Promise<boolean> {
    const rows = await this.db.execute<{ one: number }>(sql`
      SELECT 1 AS one FROM client_folders
      WHERE client_id = ${clientId}
        AND coalesce(parent_id, '') = ${parentId ?? ''}
        AND lower(name) = lower(${name})
        AND removed_at IS NULL
        AND id <> ${exceptId ?? ''}
    `);
    return rows.length > 0;
  }

  async folderHasContents(folderId: string): Promise<boolean> {
    const rows = await this.db.execute<{ one: number }>(sql`
      SELECT 1 AS one WHERE
        EXISTS (SELECT 1 FROM client_files WHERE folder_id = ${folderId} AND removed_at IS NULL)
        OR EXISTS (SELECT 1 FROM client_folders WHERE parent_id = ${folderId} AND removed_at IS NULL)
    `);
    return rows.length > 0;
  }

  async saveFolder(folder: ClientFolder): Promise<void> {
    this.collector?.collect(folder.pullEvents());
    const state = folder.snapshot();
    await this.db.execute(sql`
      INSERT INTO client_folders
        (id, client_id, parent_id, name, created_by, created_at, removed_at, removed_by)
      VALUES (${state.id}, ${state.clientId}, ${state.parentId}, ${state.name},
              ${state.createdBy}, ${state.createdAt.toISOString()},
              ${state.removedAt?.toISOString() ?? null}, ${state.removedBy})
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        removed_at = excluded.removed_at,
        removed_by = excluded.removed_by
    `);
  }
}

type FolderRow = {
  id: string;
  client_id: string;
  parent_id: string | null;
  name: string;
  created_by: string;
  created_at: string;
  removed_at: string | null;
  removed_by: string | null;
};

function toFolder(row: FolderRow): ClientFolder {
  return ClientFolder.rehydrate({
    id: row.id,
    clientId: row.client_id,
    parentId: row.parent_id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    removedAt: at(row.removed_at),
    removedBy: row.removed_by,
  });
}
