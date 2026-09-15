import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_CLIENTS, Client, ClientDocument, assignedTo } from '../domain/index.js';
import { DrizzleClientRepository } from './client.repository.js';
import { DrizzleDocumentRepository } from './document.repository.js';
import { DrizzleStaffAccessRepository } from './staff-access.repository.js';

const at = (iso: string) => new Date(iso);
const TODAY = at('2026-09-15T06:00:00Z');

describe('client documents against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  async function scenario(tx: unknown) {
    const db = tx as ReturnType<typeof drizzle>;
    const clients = new DrizzleClientRepository(db);
    const documents = new DrizzleDocumentRepository(db);
    const access = new DrizzleStaffAccessRepository(db);

    await db.execute(
      `INSERT INTO users (id, email, display_name, password_hash)
       VALUES ('user-a', 'a@activemanagement.ae', 'Accountant A', 'x')`,
    );

    for (const id of ['c-1', 'c-2']) {
      const created = Client.onboard({
        id,
        legalName: `${id} LLC`,
        now: at('2026-01-10T06:00:00Z'),
      });
      if (!created.ok) throw new Error('fixture');
      await clients.save(created.value);
    }
    await access.assign({ clientId: 'c-1', userId: 'user-a', assignedBy: 'manager' });

    return { documents, access };
  }

  function licence(id: string, clientId: string, expiresOn: string) {
    const document = ClientDocument.require({
      id,
      clientId,
      type: 'trade_licence',
      now: at('2026-01-10T06:00:00Z'),
    });
    document.receive({
      storageKey: `clients/${clientId}/documents/${id}.pdf`,
      originalName: 'trade-licence.pdf',
      checksum: 'a'.repeat(64),
      issuedOn: at('2026-01-01T00:00:00Z'),
      expiresOn: at(expiresOn),
      uploadedBy: 'user-a',
      now: at('2026-01-10T06:00:00Z'),
    });
    return document;
  }

  it('saves a document and reads it back with its dates intact', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { documents } = await scenario(tx);
      await documents.save(licence('doc-1', 'c-1', '2026-12-31T00:00:00Z'));

      const found = await documents.findById('doc-1', ALL_CLIENTS);
      expect(found?.status).toBe('held');
      expect(found?.expiresOn?.toISOString().slice(0, 10)).toBe('2026-12-31');
      expect(found?.expiryStateOn(TODAY)).toBe('valid');
    });
  });

  it('reaches a document only through a client the caller may see', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { documents } = await scenario(tx);
      await documents.save(licence('doc-1', 'c-1', '2026-12-31T00:00:00Z'));
      await documents.save(licence('doc-2', 'c-2', '2026-12-31T00:00:00Z'));

      // Assigned to c-1 only. The document on c-2 is out of reach, and answers
      // the same way as one that does not exist.
      expect(await documents.findById('doc-1', assignedTo('user-a'))).not.toBeNull();
      expect(await documents.findById('doc-2', assignedTo('user-a'))).toBeNull();
    });
  });

  it('lists the current documents and leaves superseded versions out', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { documents } = await scenario(tx);
      const old = licence('doc-old', 'c-1', '2026-06-30T00:00:00Z');
      await documents.save(old);

      // Order matters, and only one order works: supersede the old version
      // first so it leaves the live-document index, then insert the
      // replacement. The link between them is checked at commit.
      old.supersede('doc-new', at('2026-06-15T06:00:00Z'));
      await documents.save(old);
      await documents.save(licence('doc-new', 'c-1', '2027-06-30T00:00:00Z'));

      const current = await documents.currentFor('c-1', ALL_CLIENTS);
      expect(current.map((d) => d.id)).toEqual(['doc-new']);
    });
  });

  it('refuses two live documents of the same type for one client', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { documents } = await scenario(tx);
      await documents.save(licence('doc-1', 'c-1', '2026-12-31T00:00:00Z'));

      // A second live trade licence would make "the licence" ambiguous.
      await expect(
        documents.save(licence('doc-2', 'c-1', '2027-12-31T00:00:00Z')),
      ).rejects.toThrow();
    });
  });

  it('refuses a held document with no file behind it', async () => {
    await database.inRollbackTransaction(async (tx) => {
      await expect(
        tx.execute(
          `INSERT INTO client_documents (id, client_id, type, status)
           VALUES ('doc-bad', 'c-1', 'trade_licence', 'held')`,
        ),
      ).rejects.toThrow();
    });
  });

  it('finds exactly what expires on the day the engine asks about', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { documents } = await scenario(tx);
      // Ninety days from 15 September 2026 is 14 December 2026.
      await documents.save(licence('doc-90', 'c-1', '2026-12-14T00:00:00Z'));
      await documents.save(licence('doc-other', 'c-2', '2026-12-15T00:00:00Z'));

      const due = await documents.expiringOn(90, TODAY);
      expect(due.map((d) => d.documentId)).toEqual(['doc-90']);
      expect(due[0]?.clientName).toBe('c-1 LLC');
      expect(due[0]?.daysRemaining).toBe(90);
    });
  });

  it('does not chase a document that is already being renewed', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { documents } = await scenario(tx);
      const document = licence('doc-90', 'c-1', '2026-12-14T00:00:00Z');
      document.markRenewing(at('2026-09-01T06:00:00Z'));
      await documents.save(document);

      expect(await documents.expiringOn(90, TODAY)).toEqual([]);
    });
  });

  it('does not chase a version that has already been replaced', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { documents } = await scenario(tx);
      const old = licence('doc-old', 'c-1', '2026-12-14T00:00:00Z');
      await documents.save(old);

      old.supersede('doc-new', at('2026-09-01T06:00:00Z'));
      await documents.save(old);
      await documents.save(licence('doc-new', 'c-1', '2027-12-14T00:00:00Z'));

      expect(await documents.expiringOn(90, TODAY)).toEqual([]);
    });
  });
});
