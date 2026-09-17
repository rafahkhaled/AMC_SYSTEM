import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_CLIENTS, Client, NO_CLIENTS, assignedTo, scopeFor } from '../domain/index.js';
import { DrizzleClientRepository } from './client.repository.js';
import { DrizzleStaffAccessRepository } from './staff-access.repository.js';

/**
 * The rule from SRS 2.2 that the user interface must not be the only thing
 * enforcing: an accountant reaches the clients assigned to them and no others.
 *
 * These go through the repository rather than the use cases, because the
 * repository is where the promise is kept. A test that only exercises a use
 * case proves the use case remembered, not that forgetting is impossible.
 */
const at = (iso: string) => new Date(iso);

describe('an accountant only sees their own clients', () => {
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
    const access = new DrizzleStaffAccessRepository(db);

    // Two accountants, three clients, one of which is shared.
    for (const [id, name] of [
      ['user-a', 'Accountant A'],
      ['user-b', 'Accountant B'],
    ] as const) {
      await db.execute(
        `INSERT INTO users (id, email, display_name, password_hash)
         VALUES ('${id}', '${id}@activemanagement.ae', '${name}', 'x')`,
      );
      await db.execute(`INSERT INTO user_roles (user_id, role) VALUES ('${id}', 'accountant')`);
    }

    for (const id of ['c-mine', 'c-theirs', 'c-shared']) {
      const created = Client.onboard({
        id,
        legalName: `${id} LLC`,
        now: at('2026-01-10T06:00:00Z'),
      });
      if (!created.ok) throw new Error('fixture');
      await clients.save(created.value);
    }

    await access.assign({ clientId: 'c-mine', userId: 'user-a', assignedBy: 'manager' });
    await access.assign({ clientId: 'c-shared', userId: 'user-a', assignedBy: 'manager' });
    await access.assign({ clientId: 'c-theirs', userId: 'user-b', assignedBy: 'manager' });
    await access.assign({ clientId: 'c-shared', userId: 'user-b', assignedBy: 'manager' });

    return { clients, access };
  }

  it('reads an assigned client', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { clients } = await scenario(tx);
      expect(await clients.findById('c-mine', assignedTo('user-a'))).not.toBeNull();
    });
  });

  it('cannot read a client assigned to someone else', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { clients } = await scenario(tx);
      expect(await clients.findById('c-theirs', assignedTo('user-a'))).toBeNull();
    });
  });

  it('cannot tell an unassigned client from one that does not exist', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { clients } = await scenario(tx);
      // Both answer the same way. Refusing differently would confirm that a
      // particular company is on the firm's books, which is worth knowing to
      // somebody asking about a competitor.
      const hidden = await clients.findById('c-theirs', assignedTo('user-a'));
      const absent = await clients.findById('c-does-not-exist', assignedTo('user-a'));
      expect(hidden).toBe(absent);
    });
  });

  it('lists only assigned clients, and both accountants see the shared one', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { clients } = await scenario(tx);

      const forA = (await clients.list(assignedTo('user-a'))).map((c) => c.id).sort();
      const forB = (await clients.list(assignedTo('user-b'))).map((c) => c.id).sort();

      expect(forA).toEqual(['c-mine', 'c-shared']);
      expect(forB).toEqual(['c-shared', 'c-theirs']);
    });
  });

  it('shows the manager everything', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { clients } = await scenario(tx);

      // Filtered to this test's own clients. Other packages share this
      // database and commit as they run, so asserting on every row passes or
      // fails depending on what else happens to be running.
      const all = (await clients.list(ALL_CLIENTS))
        .map((c) => c.id)
        .filter((id) => id.startsWith('c-'))
        .sort();
      expect(all).toEqual(['c-mine', 'c-shared', 'c-theirs']);
    });
  });

  it('shows data entry nothing at all', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { clients } = await scenario(tx);
      expect(await clients.list(NO_CLIENTS)).toEqual([]);
      expect(await clients.findById('c-mine', NO_CLIENTS)).toBeNull();
    });
  });

  it('follows the caller permissions end to end', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { clients } = await scenario(tx);

      const accountant = scopeFor({ userId: 'user-a', permissions: ['clients.view.assigned'] });
      const clerk = scopeFor({ userId: 'user-c', permissions: ['invoices.upload'] });
      const manager = scopeFor({ userId: 'user-m', permissions: ['clients.view.all'] });

      const mine = (id: string) => id.startsWith('c-');

      expect((await clients.list(accountant)).filter((c) => mine(c.id)).length).toBe(2);
      expect((await clients.list(clerk)).length).toBe(0);
      expect((await clients.list(manager)).filter((c) => mine(c.id)).length).toBe(3);
    });
  });

  it('stops showing a client the moment the assignment is revoked', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { clients, access } = await scenario(tx);
      expect(await clients.findById('c-mine', assignedTo('user-a'))).not.toBeNull();

      await access.revoke('c-mine', 'user-a');

      // Read against the table each time, so a revocation takes effect at once
      // rather than when some cached list is next rebuilt.
      expect(await clients.findById('c-mine', assignedTo('user-a'))).toBeNull();
    });
  });

  it('treats assigning twice as no change rather than a failure', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { access } = await scenario(tx);
      await access.assign({ clientId: 'c-mine', userId: 'user-a', assignedBy: 'manager-2' });
      expect(await access.staffFor('c-mine')).toEqual(['user-a']);
    });
  });

  it('answers which clients a person has, and who a client has', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { access } = await scenario(tx);
      expect((await access.clientsFor('user-a')).sort()).toEqual(['c-mine', 'c-shared']);
      expect((await access.staffFor('c-shared')).sort()).toEqual(['user-a', 'user-b']);
    });
  });
});
