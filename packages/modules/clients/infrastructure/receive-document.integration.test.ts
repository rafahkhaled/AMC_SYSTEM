import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { Actor, UnitOfWork, UnitOfWorkContext } from '@amc/kernel';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReceiveDocument } from '../application/receive-document.js';
import { Client } from '../domain/index.js';
import { DrizzleClientRepository } from './client.repository.js';
import { DrizzleDocumentRepository } from './document.repository.js';

const at = (iso: string) => new Date(iso);

const CALLER = {
  userId: 'user-a',
  permissions: new Set(['clients.view.all', 'clients.edit']),
  roles: ['manager'],
  displayName: 'Wael Ajam',
};

/*
 * It lives beside the other integration tests rather than beside the use case
 * it exercises. The boundary rule forbids an application-layer file from
 * importing infrastructure, and a test that wires a real repository to a real
 * database is infrastructure whatever it is testing.
 */

/**
 * A unit of work that runs the work against the test's own transaction.
 *
 * The real one opens a transaction of its own, which a rollback-scoped test
 * cannot nest. What is being tested here is the order of writes against the
 * real constraints, and those hold inside any transaction.
 */
function unitOfWork(db: unknown): UnitOfWork {
  return {
    run: <T>(_actor: Actor, work: (context: UnitOfWorkContext) => Promise<T>) =>
      work({
        db,
        transaction: { transactionId: 'test' },
        actor: _actor,
        collect: () => undefined,
        audit: () => undefined,
        identify: () => undefined,
      } as unknown as UnitOfWorkContext),
  };
}

describe('receiving a document, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  async function scenario(tx: unknown) {
    const db = tx as ReturnType<typeof drizzle>;
    await db.execute(
      `INSERT INTO users (id, email, display_name, password_hash)
       VALUES ('user-a', 'wael@activemanagement.ae', 'Wael Ajam', 'x')`,
    );
    const created = Client.onboard({
      id: 'c-1',
      legalName: 'Gulf Trading LLC',
      now: at('2026-01-10T06:00:00Z'),
    });
    if (!created.ok) throw new Error('fixture');
    await new DrizzleClientRepository(db).save(created.value);

    const stored: string[] = [];
    let counter = 0;
    const receive = new ReceiveDocument(
      unitOfWork(db),
      { forTransaction: (transaction) => new DrizzleDocumentRepository(transaction as never) },
      new DrizzleDocumentRepository(db),
      {
        put: async ({ documentId }) => {
          stored.push(documentId);
          return {
            ok: true as const,
            value: { storageKey: `clients/c-1/documents/${documentId}.pdf`, checksum: 'abc' },
          };
        },
        linkTo: async (key) => `/api/files/${key}`,
      },
      { next: () => `doc-${++counter}` },
    );

    return { db, receive, documents: new DrizzleDocumentRepository(db), stored };
  }

  const licence = (over: Record<string, unknown> = {}) => ({
    clientId: 'c-1',
    type: 'trade_licence',
    expiresOn: '2027-03-31',
    filename: 'licence.pdf',
    contentType: 'application/pdf',
    body: Buffer.from('%PDF-1.4'),
    ...over,
  });

  it('replaces the licence already on file rather than colliding with it', async () => {
    /*
     * The database holds one current document of each type per client, and
     * the foreign key that records the replacement is deferred to commit so
     * the old row can be superseded first. Writing them the other way round
     * is refused, which is what this proves the use case does not do.
     */
    await database.inRollbackTransaction(async (tx) => {
      const { receive, documents } = await scenario(tx);

      const first = await receive.execute(CALLER, licence({ expiresOn: '2026-06-30' }));
      expect(first.ok).toBe(true);

      const second = await receive.execute(CALLER, licence());
      expect(second.ok).toBe(true);

      const current = await documents.currentFor('c-1', { kind: 'all' });
      expect(current.map((document) => document.type)).toEqual(['trade_licence']);
      expect(current[0]?.expiresOn?.toISOString().slice(0, 10)).toBe('2027-03-31');
    });
  });

  it('keeps the superseded version rather than overwriting it', async () => {
    // A task completed in March used the licence valid in March. The old copy
    // is what makes that provable a year later.
    await database.inRollbackTransaction(async (tx) => {
      const { db, receive } = await scenario(tx);
      await receive.execute(CALLER, licence({ expiresOn: '2026-06-30' }));
      await receive.execute(CALLER, licence());

      const rows = (await db.execute(
        `SELECT id, superseded_by_id FROM client_documents WHERE client_id = 'c-1' ORDER BY id`,
      )) as unknown as { id: string; superseded_by_id: string | null }[];

      expect(rows).toHaveLength(2);
      expect(rows[0]?.id).toBe('doc-1');
      expect(rows[0]?.superseded_by_id).toBe('doc-2');
      expect(rows[1]?.superseded_by_id).toBeNull();
    });
  });

  it('refuses a document type that expires without an expiry date', async () => {
    // Accepting it would quietly drop this client out of every renewal
    // reminder, which is the failure the system exists to prevent.
    await database.inRollbackTransaction(async (tx) => {
      const { receive } = await scenario(tx);
      const outcome = await receive.execute(CALLER, licence({ expiresOn: undefined }));
      expect(outcome.ok).toBe(false);
    });
  });

  it('refuses a type it does not keep', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { receive } = await scenario(tx);
      const outcome = await receive.execute(CALLER, licence({ type: 'nonsense' }));
      expect(outcome.ok).toBe(false);
    });
  });

  it('writes nothing when the document is refused', async () => {
    // The file is stored before the transaction opens, so a refusal leaves an
    // orphan object and no row. That is the intended trade: an unreferenced
    // object can be swept, a row pointing at a file that was never written
    // cannot be noticed until someone asks for the document.
    await database.inRollbackTransaction(async (tx) => {
      const { db, receive } = await scenario(tx);
      await receive.execute(CALLER, licence({ expiresOn: undefined }));

      const rows = await db.execute(`SELECT id FROM client_documents WHERE client_id = 'c-1'`);
      expect(rows).toHaveLength(0);
    });
  });
});
