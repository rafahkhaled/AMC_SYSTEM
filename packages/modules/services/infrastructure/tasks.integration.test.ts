import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecurringWork } from '../application/recurrence.js';
import { Task } from '../domain/index.js';
import { DrizzleClientServiceRepository } from './client-service.repository.js';
import { DrizzleTaskRepository } from './task.repository.js';

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

describe('tasks against a real database', () => {
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
    const tasks = new DrizzleTaskRepository(db);
    return { db, subscriptions, tasks };
  }

  it('saves a task with its requirements and steps, and reads it back whole', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, tasks } = await scenario(tx);
      const subscription = await subscriptions.subscribe({
        id: 'cs-1',
        clientId: 'c-1',
        service: 'vat_registration',
        activeFrom: at('2026-01-01T00:00:00Z'),
      });

      const task = Task.fromTemplate({
        id: 't-1',
        clientId: 'c-1',
        clientServiceId: subscription.id,
        service: 'vat_registration',
        now: at('2026-01-10T06:00:00Z'),
      });
      await tasks.save(task);

      const found = await tasks.findById('t-1', ALL);
      expect(found?.status).toBe('awaiting_documents');
      expect(found?.missingDocuments).toEqual([
        'trade_licence',
        'emirates_id',
        'passport',
        'memorandum',
      ]);
      expect(found?.stepsRemaining).toBe(5);
    });
  });

  it('keeps the attached documents across a save', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { db, subscriptions, tasks } = await scenario(tx);
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

      const task = Task.fromTemplate({
        id: 't-1',
        clientId: 'c-1',
        clientServiceId: 'cs-1',
        service: 'vat_registration',
        now: at('2026-01-10T06:00:00Z'),
      });
      task.attachDocument('trade_licence', 'doc-1', at('2026-01-11T06:00:00Z'));
      await tasks.save(task);

      const found = await tasks.findById('t-1', ALL);
      expect(found?.requirements.find((r) => r.type === 'trade_licence')?.documentId).toBe('doc-1');
      expect(found?.missingDocuments).toEqual(['emirates_id', 'passport', 'memorandum']);
    });
  });

  it('shows an accountant only the work for their own clients', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, tasks } = await scenario(tx);
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
        await tasks.save(
          Task.fromTemplate({
            id: `t-${clientId}`,
            clientId,
            clientServiceId: id,
            service: 'monthly_accounting',
            periodKey: '2026-08',
            now: at('2026-09-01T06:00:00Z'),
          }),
        );
      }

      const mine = await tasks.open(assignedTo('user-a'));
      expect(mine.map((task) => task.id)).toEqual(['t-c-1']);
      expect((await tasks.open(ALL)).length).toBe(2);
    });
  });

  it('refuses a task whose client does not match its subscription', async () => {
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
          `INSERT INTO tasks (id, client_service_id, client_id, service)
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
    const tasks = new DrizzleTaskRepository(db);
    await subscriptions.subscribe({
      id: 'cs-1',
      clientId: 'c-1',
      service,
      activeFrom: at('2026-01-01T00:00:00Z'),
    });
    return { db, subscriptions, tasks };
  }

  function engine(
    subscriptions: DrizzleClientServiceRepository,
    tasks: DrizzleTaskRepository,
    now: Date,
  ) {
    return new RecurringWork(subscriptions, tasks, { now: () => now }, new Ids('task'));
  }

  it('creates the month just finished, not the one still running', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, tasks } = await scenario(tx, 'monthly_accounting');
      const created = await engine(subscriptions, tasks, at('2026-09-03T06:00:00Z')).sweep(
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
      const { subscriptions, tasks } = await scenario(tx, 'monthly_accounting');
      const run = engine(subscriptions, tasks, at('2026-09-03T06:00:00Z'));

      expect(await run.sweep('monthly_accounting', new Map())).toHaveLength(1);
      // Run late, run twice, replayed after an outage: all harmless.
      expect(await run.sweep('monthly_accounting', new Map())).toHaveLength(0);
      expect(await run.sweep('monthly_accounting', new Map())).toHaveLength(0);
    });
  });

  it('uses the client own VAT cycle and dates the return on the 28th', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, tasks } = await scenario(tx, 'vat_return');

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

      const created = await engine(subscriptions, tasks, at('2026-08-02T06:00:00Z')).sweep(
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
      const { subscriptions, tasks } = await scenario(tx, 'vat_return');
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
        await engine(subscriptions, tasks, at('2026-09-02T06:00:00Z')).sweep('vat_return', cycles),
      ).toHaveLength(0);
    });
  });

  it('skips a client whose cycle nobody supplied, rather than guessing one', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, tasks } = await scenario(tx, 'vat_return');
      expect(
        await engine(subscriptions, tasks, at('2026-08-02T06:00:00Z')).sweep(
          'vat_return',
          new Map(),
        ),
      ).toHaveLength(0);
    });
  });

  it('does nothing for work that happens only once', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, tasks } = await scenario(tx, 'monthly_accounting');
      expect(
        await engine(subscriptions, tasks, at('2026-09-03T06:00:00Z')).sweep(
          'vat_registration',
          new Map(),
        ),
      ).toHaveLength(0);
    });
  });

  it('stops creating work once the subscription ends', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { subscriptions, tasks } = await scenario(tx, 'monthly_accounting');
      await subscriptions.end('cs-1', at('2026-08-31T00:00:00Z'));

      expect(
        await engine(subscriptions, tasks, at('2026-09-03T06:00:00Z')).sweep(
          'monthly_accounting',
          new Map(),
        ),
      ).toHaveLength(0);
    });
  });
});
