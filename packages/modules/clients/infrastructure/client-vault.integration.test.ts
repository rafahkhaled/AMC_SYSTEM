import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClientVault, type SecretVault } from '../application/client-vault.js';
import { Client } from '../domain/index.js';
import { DrizzleClientRepository } from './client.repository.js';
import { DrizzleCredentialRepository } from './credential.repository.js';

const at = (iso: string) => new Date(iso);

const MANAGER = {
  userId: 'user-a',
  permissions: new Set(['clients.view.all', 'clients.vault.read']),
  roles: ['manager'],
  displayName: 'Wael Ajam',
};

const ACCOUNTANT = {
  userId: 'user-b',
  permissions: new Set(['clients.view.assigned', 'clients.vault.read']),
  roles: ['accountant'],
  displayName: 'Other Accountant',
};

describe('the credential vault, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  async function scenario(tx: unknown) {
    const db = tx as ReturnType<typeof drizzle>;
    for (const [id, name] of [
      ['user-a', 'Wael Ajam'],
      ['user-b', 'Other Accountant'],
    ]) {
      await db.execute(
        `INSERT INTO users (id, email, display_name, password_hash)
         VALUES ('${id}', '${id}@activemanagement.ae', '${name}', 'x')`,
      );
    }
    const created = Client.onboard({
      id: 'c-1',
      legalName: 'Gulf Trading LLC',
      now: at('2026-01-10T06:00:00Z'),
    });
    if (!created.ok) throw new Error('fixture');
    await new DrizzleClientRepository(db).save(created.value);

    /*
     * A stand-in for the envelope cipher.
     *
     * It encodes rather than encrypts — the real cipher is proven in the
     * vault package's own tests — but it must not leave the plaintext
     * readable, or the assertion that nothing readable reaches the table
     * would be testing the fake rather than the table.
     *
     * The property it does keep honestly is the order: opening records the
     * access before it returns anything, and a recorder that throws means no
     * plaintext comes back.
     */
    const reads: { entityId: string; reason: string | undefined }[] = [];
    const recorderFails = { value: false };
    const vault: SecretVault = {
      seal: async (plaintext) => `sealed.${Buffer.from(plaintext, 'utf8').toString('base64')}`,
      open: async (sealed, access) => {
        if (recorderFails.value) throw new Error('the log refused the write');
        reads.push({ entityId: access.entityId, reason: access.reason });
        return Buffer.from(sealed.replace(/^sealed\./, ''), 'base64').toString('utf8');
      },
    };

    let counter = 0;
    return {
      db,
      reads,
      recorderFails,
      credentials: new DrizzleCredentialRepository(db),
      vault: new ClientVault(new DrizzleCredentialRepository(db), vault, {
        next: () => `cred-${++counter}`,
      }),
    };
  }

  const login = (over: Record<string, string> = {}) => ({
    clientId: 'c-1',
    kind: 'emaratax',
    username: 'gulf@portal.ae',
    secret: 'S0me-P@ssword',
    ...over,
  });

  it('never writes the password anywhere readable', async () => {
    // There is no plaintext column, so `SELECT *` cannot leak one. This is
    // the property the whole table was shaped around.
    await database.inRollbackTransaction(async (tx) => {
      const { db, vault } = await scenario(tx);
      expect((await vault.store(MANAGER, login())).ok).toBe(true);

      const rows = (await db.execute(
        `SELECT * FROM client_credentials WHERE client_id = 'c-1'`,
      )) as unknown as Record<string, unknown>[];

      const everything = JSON.stringify(rows);
      expect(everything).not.toContain('S0me-P@ssword');
      expect(everything).toContain('sealed.');
    });
  });

  it('does not put the password in the list', async () => {
    // Opening a client file must not read every password on it, or the log
    // fills with noise and the one real read cannot be found.
    await database.inRollbackTransaction(async (tx) => {
      const { vault, reads } = await scenario(tx);
      await vault.store(MANAGER, login());

      const listed = await vault.list(MANAGER, 'c-1');

      expect(listed).toHaveLength(1);
      expect(JSON.stringify(listed)).not.toContain('S0me-P@ssword');
      expect(reads).toHaveLength(0);
    });
  });

  it('records the read before it hands the password over', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { vault, reads } = await scenario(tx);
      await vault.store(MANAGER, login());

      const revealed = await vault.reveal(MANAGER, 'cred-1', 'Filing the Q3 return');

      expect(revealed.ok).toBe(true);
      if (revealed.ok) expect(revealed.value.secret).toBe('S0me-P@ssword');
      expect(reads).toEqual([{ entityId: 'cred-1', reason: 'Filing the Q3 return' }]);
    });
  });

  it('hands nothing over when the read cannot be recorded', async () => {
    /*
     * The order is the guarantee. A password shown to somebody cannot be
     * un-shown, so a log that could not be written has to stop the read
     * rather than be caught up with afterwards.
     */
    await database.inRollbackTransaction(async (tx) => {
      const { vault, recorderFails } = await scenario(tx);
      await vault.store(MANAGER, login());
      recorderFails.value = true;

      await expect(vault.reveal(MANAGER, 'cred-1', 'Filing the Q3 return')).rejects.toThrow();
    });
  });

  it('refuses to reveal without a reason', async () => {
    // A log recording twenty reads and no reasons says somebody looked, which
    // an auditor could have guessed.
    await database.inRollbackTransaction(async (tx) => {
      const { vault, reads } = await scenario(tx);
      await vault.store(MANAGER, login());

      expect((await vault.reveal(MANAGER, 'cred-1', '  ')).ok).toBe(false);
      expect(reads).toHaveLength(0);
    });
  });

  it('retires the old login when the password changes, and keeps it', async () => {
    // An audit asks who could have filed on this client's behalf last March.
    // An overwritten row cannot answer.
    await database.inRollbackTransaction(async (tx) => {
      const { db, vault } = await scenario(tx);
      await vault.store(MANAGER, login());
      await vault.store(MANAGER, login({ secret: 'A-New-P@ssword' }));

      const live = await vault.list(MANAGER, 'c-1');
      expect(live).toHaveLength(1);

      const all = (await db.execute(
        `SELECT retired_at FROM client_credentials WHERE client_id = 'c-1'`,
      )) as unknown as { retired_at: string | null }[];
      expect(all).toHaveLength(2);
      expect(all.filter((row) => row.retired_at !== null)).toHaveLength(1);
    });
  });

  it('shows an accountant nothing for a client that is not theirs', async () => {
    // Out of scope and non-existent are the same answer, so a credential id
    // cannot be used to learn which clients a firm has.
    await database.inRollbackTransaction(async (tx) => {
      const { vault } = await scenario(tx);
      await vault.store(MANAGER, login());

      expect(await vault.list(ACCOUNTANT, 'c-1')).toEqual([]);
      expect((await vault.reveal(ACCOUNTANT, 'cred-1', 'Curiosity')).ok).toBe(false);
    });
  });

  it('shows nothing at all to somebody without the vault permission', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { vault } = await scenario(tx);
      await vault.store(MANAGER, login());

      const clerk = {
        userId: 'user-b',
        permissions: new Set(['clients.view.all']),
        roles: ['data_entry'],
        displayName: 'Data Entry',
      };
      expect(await vault.list(clerk, 'c-1')).toEqual([]);
    });
  });
});
