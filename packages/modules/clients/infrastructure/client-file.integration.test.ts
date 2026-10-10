import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_CLIENTS, ClientFile, NO_CLIENTS, assignedTo } from '../domain/index.js';
import { DrizzleClientFileRepository } from './client-file.repository.js';
import { DrizzleStaffAccessRepository } from './staff-access.repository.js';

type Db = ReturnType<typeof drizzle>;

const at = (iso: string) => new Date(iso);

function file(over: Partial<Parameters<typeof ClientFile.receive>[0]> = {}): ClientFile {
  const made = ClientFile.receive({
    id: 'f-1',
    clientId: 'cf-mine',
    storageKey: 'clients/cf-mine/files/f-1.xlsx',
    name: 'Statements.xlsx',
    contentType: 'application/octet-stream',
    checksum: 'sum',
    sizeBytes: 5000,
    uploadedBy: 'cf-user',
    now: at('2026-10-10T08:00:00Z'),
    ...over,
  });
  if (!made.ok) throw made.error;
  return made.value;
}

describe('the client folder, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  async function world(db: Db) {
    await db.execute(
      `INSERT INTO users (id, email, display_name, password_hash)
       VALUES ('cf-user', 'cf@activemanagement.ae', 'Wael Ajam', 'x'),
              ('cf-acct', 'acct@activemanagement.ae', 'Layla', 'x')`,
    );
    await db.execute(
      `INSERT INTO clients (id, legal_name) VALUES ('cf-mine', 'Mine LLC'), ('cf-theirs', 'Theirs LLC')`,
    );
    await new DrizzleStaffAccessRepository(db).assign({
      clientId: 'cf-mine',
      userId: 'cf-acct',
      assignedBy: 'cf-user',
    });
  }

  it('round-trips a file, with the name of whoever kept it', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleClientFileRepository(db);
      await repository.save(file());

      const [stored] = await repository.forClient('cf-mine', ALL_CLIENTS);
      expect(stored?.uploadedByName).toBe('Wael Ajam');
      expect(stored?.file.snapshot()).toMatchObject({
        originalName: 'Statements.xlsx',
        // bigint arrives from the driver as a string and has to come out a number.
        sizeBytes: 5000,
        checksum: 'sum',
      });
      expect(stored?.file.snapshot().uploadedAt.toISOString()).toBe('2026-10-10T08:00:00.000Z');
    });
  });

  it('lists the newest first, and leaves out what was removed', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleClientFileRepository(db);

      await repository.save(
        file({ id: 'f-old', name: 'old.pdf', now: at('2026-10-01T08:00:00Z') }),
      );
      await repository.save(
        file({ id: 'f-new', name: 'new.pdf', now: at('2026-10-09T08:00:00Z') }),
      );
      const gone = file({ id: 'f-gone', name: 'gone.pdf', now: at('2026-10-05T08:00:00Z') });
      await repository.save(gone);
      gone.remove('cf-user', at('2026-10-06T08:00:00Z'));
      await repository.save(gone);

      const names = (await repository.forClient('cf-mine', ALL_CLIENTS)).map(
        (one) => one.file.snapshot().originalName,
      );
      expect(names).toEqual(['new.pdf', 'old.pdf']);

      // The row is still there: who removed it, and when, has an answer.
      const rows = await db.execute<{ removed_by: string }>(
        `SELECT removed_by FROM client_files WHERE id = 'f-gone'` as never,
      );
      expect(rows[0]?.removed_by).toBe('cf-user');
    });
  });

  it('shows an accountant only the folders of their own clients', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleClientFileRepository(db);
      await repository.save(file({ id: 'f-mine', clientId: 'cf-mine' }));
      await repository.save(
        file({
          id: 'f-theirs',
          clientId: 'cf-theirs',
          storageKey: 'clients/cf-theirs/files/f-theirs',
        }),
      );

      const mine = assignedTo('cf-acct');
      expect(await repository.forClient('cf-mine', mine)).toHaveLength(1);
      // Not forbidden, empty: a count would confirm the client exists.
      expect(await repository.forClient('cf-theirs', mine)).toEqual([]);
      expect(await repository.forClient('cf-mine', NO_CLIENTS)).toEqual([]);

      expect(await repository.canReach('cf-mine', mine)).toBe(true);
      expect(await repository.canReach('cf-theirs', mine)).toBe(false);
      expect(await repository.canReach('cf-theirs', ALL_CLIENTS)).toBe(true);
    });
  });

  it('answers a file in an unreachable client exactly as it answers one that is not there', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleClientFileRepository(db);
      await repository.save(
        file({
          id: 'f-theirs',
          clientId: 'cf-theirs',
          storageKey: 'clients/cf-theirs/files/f-theirs',
        }),
      );

      expect(await repository.findById('f-theirs', assignedTo('cf-acct'))).toBeNull();
      expect(await repository.findById('no-such-file', assignedTo('cf-acct'))).toBeNull();
      expect(await repository.findById('f-theirs', ALL_CLIENTS)).not.toBeNull();
    });
  });

  it('refuses rows the rules would not have written, past the aggregate', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      const insert = (id: string, size: number, removedBy: string | null) =>
        db.execute(
          `INSERT INTO client_files
             (id, client_id, storage_key, original_name, content_type, checksum, size_bytes,
              uploaded_by, removed_at, removed_by)
           VALUES ('${id}', 'cf-mine', 'k/${id}', 'n.pdf', 'x', 'c', ${size}, 'cf-user',
                   ${removedBy ? 'now()' : 'NULL'}, ${removedBy ? `'${removedBy}'` : 'NULL'})` as never,
        );

      await expect(insert('ok', 10, null)).resolves.toBeDefined();
      // Empty, and "removed" with nobody to have removed it.
      await expect(insert('empty', 0, null)).rejects.toThrow();
      await expect(
        db.execute(
          `INSERT INTO client_files
             (id, client_id, storage_key, original_name, content_type, checksum, size_bytes,
              uploaded_by, removed_at)
           VALUES ('half', 'cf-mine', 'k/half', 'n.pdf', 'x', 'c', 10, 'cf-user', now())` as never,
        ),
      ).rejects.toThrow();
    });
  });

  it('will not let a client with files be deleted from under them', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await new DrizzleClientFileRepository(db).save(file());

      await expect(
        db.execute(`DELETE FROM clients WHERE id = 'cf-mine'` as never),
      ).rejects.toThrow();
    });
  });
});
