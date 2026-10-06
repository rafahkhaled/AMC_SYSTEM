import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import { Duration, Money } from '@amc/kernel';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RaiseInvoice } from '../application/raise-invoice.js';
import { CountingIds, FakeClock } from '../application/test-doubles.js';
import { Statement, type StatementLine } from '../domain/index.js';
import { DrizzleBillingReader } from './billing.reader.js';
import { DrizzleDocumentNumbering, DrizzleInvoiceRepository } from './invoice.repository.js';
import { DrizzleStatementRepository } from './statement.repository.js';

type Db = ReturnType<typeof drizzle>;

const NOW = new Date('2026-10-01T08:00:00.000Z');
const aed = (minor: number) => Money.ofMinor(minor, 'AED');
const ALL = { kind: 'all' } as const;

async function world(db: Db): Promise<void> {
  await db.execute(`
    INSERT INTO users (id, email, display_name, password_hash) VALUES
      ('r-boss', 'boss@activemanagement.ae', 'Wael Ajam', 'x'),
      ('r-hana', 'hana@activemanagement.ae', 'Hana Saeed', 'x'),
      ('r-omar', 'omar@activemanagement.ae', 'Omar Nasser', 'x')
  `);
  await db.execute(`
    INSERT INTO clients (id, legal_name) VALUES
      ('r-gulf', 'Gulf Trading LLC'), ('r-delta', 'Delta Services')
  `);
  await db.execute(`
    INSERT INTO client_staff_access (client_id, user_id, assigned_by) VALUES
      ('r-gulf', 'r-hana', 'r-boss'), ('r-delta', 'r-omar', 'r-boss')
  `);
  for (const [id, client] of [
    ['r-cs-gulf', 'r-gulf'],
    ['r-cs-delta', 'r-delta'],
  ] as const) {
    await db.execute(
      `INSERT INTO client_services (id, client_id, service, active_from)
       VALUES ('${id}', '${client}', 'vat_return', '2026-01-01')`,
    );
  }
  for (const [id, cs, client] of [
    ['r-t-gulf', 'r-cs-gulf', 'r-gulf'],
    ['r-t-delta', 'r-cs-delta', 'r-delta'],
  ] as const) {
    await db.execute(
      `INSERT INTO projects (id, client_service_id, client_id, service, state)
       VALUES ('${id}', '${cs}', '${client}', 'vat_return', 'in_progress')`,
    );
  }
}

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  id: 'r-l1',
  projectId: 'r-t-gulf',
  service: 'vat_return',
  performedOn: new Date('2026-09-03T00:00:00.000Z'),
  userId: 'r-hana',
  worked: Duration.ofHours(2),
  pricing: { kind: 'hourly', perHour: aed(30_000) },
  entryIds: [],
  excluded: false,
  excludedReason: null,
  adjustedTo: null,
  adjustedReason: null,
  ...over,
});

function statementOf(id: string, clientId: string, lines: StatementLine[]) {
  const made = Statement.draft({
    id,
    clientId,
    periodStart: new Date('2026-09-01T00:00:00.000Z'),
    periodEnd: new Date('2026-09-30T00:00:00.000Z'),
    currency: 'AED',
    lines,
    createdBy: 'r-boss',
    now: NOW,
  });
  if (!made.ok) throw made.error;
  return made.value;
}

describe('the billing screens, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('reads several statements at once, each with its own lines', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleStatementRepository(db);

      /*
       * More than one of each, deliberately.
       *
       * The lines are fetched with `id = ANY(...)`, and Drizzle expands a bare
       * JavaScript array into one placeholder per element — which Postgres
       * reads as a record and refuses outright. It typechecks either way, and
       * a fixture with a single statement and a single line never reaches the
       * failing path.
       */
      await repository.save(
        statementOf('r-s1', 'r-gulf', [
          line({ id: 'r-l1' }),
          line({ id: 'r-l2', worked: Duration.ofHours(1) }),
        ]),
      );
      await repository.save(
        statementOf('r-s2', 'r-delta', [line({ id: 'r-l3', projectId: 'r-t-delta' })]),
      );

      const reader = new DrizzleBillingReader(db);
      const all = await reader.statements(ALL, null);

      expect(all).toHaveLength(2);
      const gulf = all.find((statement) => statement.id === 'r-s1');
      expect(gulf?.lines).toHaveLength(2);
      expect(gulf?.total.minorUnits).toBe(90_000);
      expect(gulf?.clientName).toBe('Gulf Trading LLC');
      // The line names the person, because the client asks who did the work.
      expect(gulf?.lines[0]?.userName).toBe('Hana Saeed');
    });
  });

  it('shows what was worked beside what will be billed', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleStatementRepository(db);

      const statement = statementOf('r-s1', 'r-gulf', [line({ id: 'r-l1' }), line({ id: 'r-l2' })]);
      statement.exclude('r-l2', 'written off, client goodwill', NOW);
      await repository.save(statement);

      const view = await new DrizzleBillingReader(db).statement('r-s1', ALL);
      expect(view?.totalAsWorked.minorUnits).toBe(120_000);
      expect(view?.total.minorUnits).toBe(60_000);
      expect(view?.lines.find((l) => l.excluded)?.excludedReason).toBe(
        'written off, client goodwill',
      );
    });
  });

  it('prices a part hour the same way the domain does', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleStatementRepository(db);

      // 1h30 at 123.45 is 185.175, which has to round one way by one rule.
      // The reader works in plain integers and the domain in Money; they must
      // still agree to the fils.
      const statement = statementOf('r-s1', 'r-gulf', [
        line({ worked: Duration.ofMinutes(90), pricing: { kind: 'hourly', perHour: aed(12_345) } }),
      ]);
      await repository.save(statement);

      const view = await new DrizzleBillingReader(db).statement('r-s1', ALL);
      expect(view?.total.minorUnits).toBe(statement.total().minorUnits);
      expect(view?.total.minorUnits).toBe(18_518);
    });
  });

  it('shows an accountant their own clients and not another’s', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleStatementRepository(db);
      await repository.save(statementOf('r-s1', 'r-gulf', [line()]));
      await repository.save(
        statementOf('r-s2', 'r-delta', [line({ id: 'r-l3', projectId: 'r-t-delta' })]),
      );

      const reader = new DrizzleBillingReader(db);
      const hana = await reader.statements({ kind: 'assigned', userId: 'r-hana' }, null);
      const omar = await reader.statements({ kind: 'assigned', userId: 'r-omar' }, null);

      expect(hana.map((s) => s.id)).toEqual(['r-s1']);
      expect(omar.map((s) => s.id)).toEqual(['r-s2']);
      expect(await reader.statements({ kind: 'none' }, null)).toEqual([]);
    });
  });

  it('answers not found for a statement out of scope', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await new DrizzleStatementRepository(db).save(statementOf('r-s1', 'r-gulf', [line()]));

      const reader = new DrizzleBillingReader(db);
      // A 403 would confirm the statement exists, which is the thing being
      // withheld.
      expect(await reader.statement('r-s1', { kind: 'assigned', userId: 'r-omar' })).toBeNull();
      expect(await reader.statement('r-s1', { kind: 'assigned', userId: 'r-hana' })).not.toBeNull();
    });
  });

  it('reads invoices with their lines and payments', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      const statements = new DrizzleStatementRepository(db);
      const statement = statementOf('r-s1', 'r-gulf', [
        line({ id: 'r-l1' }),
        line({ id: 'r-l2', worked: Duration.ofHours(1) }),
      ]);
      statement.approve('r-boss', NOW);
      await statements.save(statement);

      const invoices = new DrizzleInvoiceRepository(db);
      const raised = await new RaiseInvoice(
        statements,
        invoices,
        new DrizzleDocumentNumbering(db),
        { vatBasisPoints: 500, paymentTermsDays: 30 },
        new FakeClock(NOW),
        new CountingIds(),
      ).execute('r-boss', 'r-s1');
      if (!raised.ok) throw raised.error;

      const invoice = await invoices.findById(raised.value.invoiceId);
      if (!invoice) throw new Error('missing');
      invoice.recordPayment({
        id: 'r-p1',
        amount: aed(20_000),
        receivedOn: new Date('2026-10-10T00:00:00Z'),
        method: 'bank_transfer',
        reference: 'FT1',
        chequeNumber: null,
        chequeDate: null,
        bankName: null,
        discount: Money.zero('AED'),
        discountReason: null,
        recordedBy: 'r-boss',
      });
      await invoices.save(invoice);

      const view = await new DrizzleBillingReader(db).invoice(raised.value.invoiceId, ALL);
      expect(view?.lines).toHaveLength(2);
      expect(view?.payments).toHaveLength(1);
      expect(view?.net.minorUnits).toBe(90_000);
      expect(view?.vat.minorUnits).toBe(4_500);
      expect(view?.total.minorUnits).toBe(94_500);
      expect(view?.balance.minorUnits).toBe(74_500);
      expect(view?.status).toBe('part_paid');
      // The reader and the aggregate must agree to the fils.
      expect(view?.total.minorUnits).toBe(invoice.total().minorUnits);
    });
  });

  it('lists only what is outstanding when asked', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      const statements = new DrizzleStatementRepository(db);
      const invoices = new DrizzleInvoiceRepository(db);
      const raise = new RaiseInvoice(
        statements,
        invoices,
        new DrizzleDocumentNumbering(db),
        { vatBasisPoints: 0, paymentTermsDays: 30 },
        new FakeClock(NOW),
        new CountingIds(),
      );

      for (const [id, client, project] of [
        ['r-s1', 'r-gulf', 'r-t-gulf'],
        ['r-s2', 'r-delta', 'r-t-delta'],
      ] as const) {
        const statement = statementOf(id, client, [line({ id: `${id}-l`, projectId: project })]);
        statement.approve('r-boss', NOW);
        await statements.save(statement);
        const raised = await raise.execute('r-boss', id);
        if (!raised.ok) throw raised.error;

        if (id === 'r-s1') {
          const invoice = await invoices.findById(raised.value.invoiceId);
          if (!invoice) throw new Error('missing');
          invoice.recordPayment({
            id: 'r-p-full',
            amount: aed(60_000),
            receivedOn: new Date('2026-10-05T00:00:00Z'),
            method: 'cash',
            reference: null,
            chequeNumber: null,
            chequeDate: null,
            bankName: null,
            discount: Money.zero('AED'),
            discountReason: null,
            recordedBy: 'r-boss',
          });
          await invoices.save(invoice);
        }
      }

      const reader = new DrizzleBillingReader(db);
      const everything = await reader.invoices(ALL, { outstandingOnly: false, asOf: NOW });
      const owing = await reader.invoices(ALL, { outstandingOnly: true, asOf: NOW });

      expect(everything).toHaveLength(2);
      expect(owing).toHaveLength(1);
      expect(owing[0]?.clientName).toBe('Delta Services');
    });
  });
});

describe('the existing-client exception, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  /** An issued, unpaid invoice for Gulf, who has one project in progress. */
  async function unpaidInvoice(db: Db, over: Record<string, string> = {}): Promise<void> {
    const settlement = over.settlement ?? 'issued';
    const overdue = over.overdueSince ? `'${over.overdueSince}'` : 'NULL';
    // The schema refuses a cancelled invoice with no reason, which is right:
    // a cancellation nobody explained is the one somebody has to explain later.
    const reason = settlement === 'cancelled' ? `'billed the wrong client'` : 'NULL';
    await db.execute(`
      INSERT INTO statements (id, client_id, period_start, period_end, state, created_by,
                              approved_at, approved_by)
      VALUES ('cp-s1', 'r-gulf', '2026-09-01', '2026-09-30', 'invoiced', 'r-boss',
              now(), 'r-boss')
    `);
    await db.execute(`
      INSERT INTO invoices (id, client_id, statement_id, number, settlement, currency,
                            vat_basis_points, issued_on, due_on, issued_by, overdue_since,
                            cancelled_reason)
      VALUES ('cp-i1', 'r-gulf', 'cp-s1', '3001', '${settlement}', 'AED', 500,
              '2026-09-20T08:00:00Z', '2026-10-20T08:00:00Z', 'r-boss', ${overdue},
              ${reason})
    `);
    await db.execute(`
      INSERT INTO invoice_lines (id, invoice_id, project_id, service, description_en,
                                 description_ar, worked_seconds, amount_minor, position)
      VALUES ('cp-il1', 'cp-i1', 'r-t-gulf', 'vat_return', 'VAT return', 'الإقرار',
              7200, 130000, 0)
    `);
  }

  const only = async (db: Db) =>
    (await new DrizzleBillingReader(db).invoices(ALL, { outstandingOnly: false, asOf: NOW }))[0];

  it('flags an unpaid invoice while the client still has work open', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await unpaidInvoice(db);

      const invoice = await only(db);
      // Neither half is remarkable alone. Together they are a decision
      // somebody made to carry on before being paid.
      expect(invoice?.collectionPending).toBe(true);
      expect(invoice?.openProjects).toBe(1);
    });
  });

  it('flags a part-paid one too', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await unpaidInvoice(db, { settlement: 'part_paid' });
      expect((await only(db))?.collectionPending).toBe(true);
    });
  });

  it('does not flag one that is merely unpaid, with nothing open', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      // The schema refuses a completed project with no completion date.
      await db.execute(`
        UPDATE projects SET state = 'completed', completed_at = '2026-09-19T08:00:00Z'
        WHERE client_id = 'r-gulf'
      `);
      await unpaidInvoice(db);

      const invoice = await only(db);
      // An unpaid invoice on its own is ordinary, and saying so about every
      // one of them would make the flag mean nothing.
      expect(invoice?.collectionPending).toBe(false);
      expect(invoice?.openProjects).toBe(0);
    });
  });

  it('does not flag a late one: that is collections, not an exception', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await unpaidInvoice(db, { overdueSince: '2026-10-21T00:00:00Z' });

      const invoice = await only(db);
      expect(invoice?.status).toBe('overdue');
      // Calling it "collection pending" once it is late would hide the harder
      // fact behind the softer word.
      expect(invoice?.collectionPending).toBe(false);
    });
  });

  it('does not flag one that has been paid, or cancelled', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await unpaidInvoice(db, { settlement: 'paid' });
      expect((await only(db))?.collectionPending).toBe(false);
    });

    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await unpaidInvoice(db, { settlement: 'cancelled' });
      expect((await only(db))?.collectionPending).toBe(false);
    });
  });

  it('counts only that client’s open work, not the whole practice', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await db.execute(`
        INSERT INTO projects (id, client_service_id, client_id, service, state)
        VALUES ('cp-p2', 'r-cs-gulf', 'r-gulf', 'vat_return', 'in_progress'),
               ('cp-p3', 'r-cs-delta', 'r-delta', 'vat_return', 'in_progress')
      `);
      await unpaidInvoice(db);

      // Delta has work open too, and it has nothing to do with this invoice.
      expect((await only(db))?.openProjects).toBe(2);
    });
  });
});
