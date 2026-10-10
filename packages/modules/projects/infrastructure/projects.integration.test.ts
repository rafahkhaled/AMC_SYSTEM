import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecurringWork } from '../application/recurrence.js';
import { Project } from '../domain/index.js';
import { DrizzleClientServiceRepository } from './client-service.repository.js';
import { DrizzleProjectRepository } from './project.repository.js';

const at = (iso: string) => new Date(iso);
const ALL = { kind: 'all' } as const;
const assignedTo = (userId: string) => ({ kind: 'assigned', userId }) as const;

class Ids {
  private counter = 0;
  constructor(private readonly prefix: string) {}
  next(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }
}

describe('projects against a real database', () => {
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
       VALUES ('user-a', 'a@activemanagement.ae', 'Accountant A', 'x')`,
    );
    for (const id of ['c-1', 'c-2']) {
      await db.execute(`INSERT INTO clients (id, legal_name) VALUES ('${id}', '${id} LLC')`);
    }
    await db.execute(
      `INSERT INTO client_staff_access (client_id, user_id, assigned_by)
       VALUES ('c-1', 'user-a', 'manager')`,
    );

    const subscriptions = new DrizzleClientServiceRepository(db);
    const projects = new DrizzleProjectRepository(db);
    return { db, subscriptions, projects };
  }

  it('saves a project with its requirements and tasks, and reads it back whole', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, projects } = await scenario(tx);
      const subscription = await subscriptions.subscribe({
        id: 'cs-1',
        clientId: 'c-1',
        service: 'vat_registration',
        activeFrom: at('2026-01-01T00:00:00Z'),
      });

      const project = Project.fromTemplate({
        id: 't-1',
        clientId: 'c-1',
        clientServiceId: subscription.id,
        service: 'vat_registration',
        now: at('2026-01-10T06:00:00Z'),
      });
      await projects.save(project);

      const found = await projects.findById('t-1', ALL);
      expect(found?.status).toBe('awaiting_documents');
      expect(found?.missingDocuments).toEqual([
        'trade_licence',
        'emirates_id',
        'passport',
        'memorandum',
      ]);
      expect(found?.tasksRemaining).toBe(5);
    });
  });

  it('keeps the attached documents across a save', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { db, subscriptions, projects } = await scenario(tx);
      await subscriptions.subscribe({
        id: 'cs-1',
        clientId: 'c-1',
        service: 'vat_registration',
        activeFrom: at('2026-01-01T00:00:00Z'),
      });
      await db.execute(
        `INSERT INTO client_documents (id, client_id, type, status, storage_key, checksum)
         VALUES ('doc-1', 'c-1', 'trade_licence', 'held', 'k', 'c')`,
      );

      const project = Project.fromTemplate({
        id: 't-1',
        clientId: 'c-1',
        clientServiceId: 'cs-1',
        service: 'vat_registration',
        now: at('2026-01-10T06:00:00Z'),
      });
      project.attachDocument('trade_licence', 'doc-1', at('2026-01-11T06:00:00Z'));
      await projects.save(project);

      const found = await projects.findById('t-1', ALL);
      expect(found?.requirements.find((r) => r.type === 'trade_licence')?.documentId).toBe('doc-1');
      expect(found?.missingDocuments).toEqual(['emirates_id', 'passport', 'memorandum']);
    });
  });

  it('shows an accountant only the work for their own clients', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, projects } = await scenario(tx);
      for (const [id, clientId] of [
        ['cs-1', 'c-1'],
        ['cs-2', 'c-2'],
      ] as const) {
        await subscriptions.subscribe({
          id,
          clientId,
          service: 'monthly_accounting',
          activeFrom: at('2026-01-01T00:00:00Z'),
        });
        await projects.save(
          Project.fromTemplate({
            id: `t-${clientId}`,
            clientId,
            clientServiceId: id,
            service: 'monthly_accounting',
            periodKey: '2026-08',
            now: at('2026-09-01T06:00:00Z'),
          }),
        );
      }

      const mine = await projects.open(assignedTo('user-a'));
      expect(mine.map((project) => project.id)).toEqual(['t-c-1']);

      // Counted among this test's own projects rather than every row in the
      // database. Other packages share this database and commit as they go,
      // so a global count would pass or fail depending on what else is
      // running at the time.
      const all = await projects.open(ALL);
      expect(
        all
          .filter((project) => project.id.startsWith('t-c-'))
          .map((project) => project.id)
          .sort(),
      ).toEqual(['t-c-1', 't-c-2']);
    });
  });

  it('refuses a project whose client does not match its subscription', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { db, subscriptions } = await scenario(tx);
      await subscriptions.subscribe({
        id: 'cs-1',
        clientId: 'c-1',
        service: 'monthly_accounting',
        activeFrom: at('2026-01-01T00:00:00Z'),
      });

      // The composite key makes this impossible even straight through SQL.
      await expect(
        db.execute(
          `INSERT INTO projects (id, client_service_id, client_id, service)
           VALUES ('t-bad', 'cs-1', 'c-2', 'monthly_accounting')`,
        ),
      ).rejects.toThrow();
    });
  });
});

describe('recurring work (FR-14)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  async function scenario(tx: unknown, service: 'monthly_accounting' | 'vat_return') {
    const db = tx as ReturnType<typeof drizzle>;
    await db.execute(`INSERT INTO clients (id, legal_name) VALUES ('c-1', 'Gulf Trading LLC')`);

    const subscriptions = new DrizzleClientServiceRepository(db);
    const projects = new DrizzleProjectRepository(db);
    await subscriptions.subscribe({
      id: 'cs-1',
      clientId: 'c-1',
      service,
      activeFrom: at('2026-01-01T00:00:00Z'),
    });
    return { db, subscriptions, projects };
  }

  function engine(
    subscriptions: DrizzleClientServiceRepository,
    projects: DrizzleProjectRepository,
    now: Date,
  ) {
    return new RecurringWork(subscriptions, projects, { now: () => now }, new Ids('project'));
  }

  it('creates the month just finished, not the one still running', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, projects } = await scenario(tx, 'monthly_accounting');
      const created = await engine(subscriptions, projects, at('2026-09-03T06:00:00Z')).sweep(
        'monthly_accounting',
        new Map(),
      );

      // Bookkeeping for August is done in September.
      expect(created).toHaveLength(1);
      expect(created[0]?.periodKey).toBe('2026-08');
    });
  });

  it('creates nothing on a second run, so the sweep is safe to replay', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, projects } = await scenario(tx, 'monthly_accounting');
      const run = engine(subscriptions, projects, at('2026-09-03T06:00:00Z'));

      expect(await run.sweep('monthly_accounting', new Map())).toHaveLength(1);
      // Run late, run twice, replayed after an outage: all harmless.
      expect(await run.sweep('monthly_accounting', new Map())).toHaveLength(0);
      expect(await run.sweep('monthly_accounting', new Map())).toHaveLength(0);
    });
  });

  it('uses the client own VAT cycle and dates the return on the 28th', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, projects } = await scenario(tx, 'vat_return');

      // A client whose quarters end in January, April, July and October.
      const cycles = new Map([
        [
          'c-1',
          {
            clientId: 'c-1',
            vatPeriodFor: (date: Date) => {
              void date;
              return {
                start: at('2026-05-01T00:00:00Z'),
                end: at('2026-07-31T00:00:00Z'),
                key: '2026-Q3-07',
              };
            },
          },
        ],
      ]);

      const created = await engine(subscriptions, projects, at('2026-08-02T06:00:00Z')).sweep(
        'vat_return',
        cycles,
      );

      expect(created[0]?.periodKey).toBe('2026-Q3-07');
      // The 28th of the month after the period ends.
      expect(created[0]?.dueAt?.toISOString().slice(0, 10)).toBe('2026-08-28');
    });
  });

  it('waits until the period has actually closed', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, projects } = await scenario(tx, 'vat_return');
      const cycles = new Map([
        [
          'c-1',
          {
            clientId: 'c-1',
            vatPeriodFor: () => ({
              start: at('2026-08-01T00:00:00Z'),
              end: at('2026-10-31T00:00:00Z'),
              key: '2026-Q4-10',
            }),
          },
        ],
      ]);

      // Starting the return for a quarter still running would have the
      // accountant preparing figures that are not final.
      expect(
        await engine(subscriptions, projects, at('2026-09-02T06:00:00Z')).sweep(
          'vat_return',
          cycles,
        ),
      ).toHaveLength(0);
    });
  });

  it('skips a client whose cycle nobody supplied, rather than guessing one', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, projects } = await scenario(tx, 'vat_return');
      expect(
        await engine(subscriptions, projects, at('2026-08-02T06:00:00Z')).sweep(
          'vat_return',
          new Map(),
        ),
      ).toHaveLength(0);
    });
  });

  it('does nothing for work that happens only once', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, projects } = await scenario(tx, 'monthly_accounting');
      expect(
        await engine(subscriptions, projects, at('2026-09-03T06:00:00Z')).sweep(
          'vat_registration',
          new Map(),
        ),
      ).toHaveLength(0);
    });
  });

  it('stops creating work once the subscription ends', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, projects } = await scenario(tx, 'monthly_accounting');
      await subscriptions.end('cs-1', at('2026-08-31T00:00:00Z'));

      expect(
        await engine(subscriptions, projects, at('2026-09-03T06:00:00Z')).sweep(
          'monthly_accounting',
          new Map(),
        ),
      ).toHaveLength(0);
    });
  });

  /*
   * Stopping a job repeating and starting it again (feedback item 9).
   *
   * Starting again makes a new subscription row. The period that was opened
   * under the old one is still that period's project, so the sweep running
   * under the new one must not open it a second time.
   */
  it('does not open a period twice because the client was re-engaged in between', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, projects } = await scenario(tx, 'monthly_accounting');

      // September opened under the first engagement...
      await engine(subscriptions, projects, at('2026-10-03T06:00:00Z')).sweep(
        'monthly_accounting',
        new Map(),
      );
      // ...which is then stopped, and the client engaged again.
      await subscriptions.end('cs-1', at('2026-10-05T00:00:00Z'));
      await subscriptions.subscribe({
        id: 'cs-2',
        clientId: 'c-1',
        service: 'monthly_accounting',
        activeFrom: at('2026-10-06T00:00:00Z'),
      });

      expect(await projects.existsForPeriod('cs-1', '2026-09')).toBe(true);
      // Asked under the *new* engagement, and still answered yes.
      expect(await projects.existsForPeriod('cs-2', '2026-09')).toBe(true);
      expect(
        await engine(subscriptions, projects, at('2026-10-08T06:00:00Z')).sweep(
          'monthly_accounting',
          new Map(),
        ),
      ).toHaveLength(0);
    });
  });

  it('does not confuse the same period of a different service or a different client', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, projects } = await scenario(tx, 'monthly_accounting');
      await engine(subscriptions, projects, at('2026-10-03T06:00:00Z')).sweep(
        'monthly_accounting',
        new Map(),
      );
      await (tx as unknown as ReturnType<typeof drizzle>).execute(
        `INSERT INTO clients (id, legal_name) VALUES ('c-other', 'Other LLC')`,
      );
      await subscriptions.subscribe({
        id: 'cs-other-client',
        clientId: 'c-other',
        service: 'monthly_accounting',
        activeFrom: at('2026-01-01T00:00:00Z'),
      });
      await subscriptions.subscribe({
        id: 'cs-other-service',
        clientId: 'c-1',
        service: 'audit',
        activeFrom: at('2026-01-01T00:00:00Z'),
      });

      expect(await projects.existsForPeriod('cs-other-client', '2026-09')).toBe(false);
      expect(await projects.existsForPeriod('cs-other-service', '2026-09')).toBe(false);
      expect(await projects.existsForPeriod('cs-1', '2026-08')).toBe(false);
    });
  });
});
