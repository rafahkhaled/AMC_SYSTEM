import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import { Duration, Money } from '@amc/kernel';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RaiseInvoice } from '../application/raise-invoice.js';
import { CountingIds, FakeClock } from '../application/test-doubles.js';
import { Statement, type StatementLine } from '../domain/index.js';
import { DrizzleDocumentNumbering, DrizzleInvoiceRepository } from './invoice.repository.js';
import { DrizzleStatementRepository } from './statement.repository.js';

type Db = ReturnType<typeof drizzle>;

const NOW = new Date('2026-10-01T08:00:00.000Z');
const aed = (minor: number) => Money.ofMinor(minor, 'AED');

async function world(db: Db): Promise<void> {
  await db.execute(`
    INSERT INTO users (id, email, display_name, password_hash)
    VALUES ('b-u1', 'wael@activemanagement.ae', 'Wael Ajam', 'x')
  `);
  await db.execute(`INSERT INTO clients (id, legal_name) VALUES ('b-c1', 'Gulf Trading LLC')`);
  await db.execute(`
    INSERT INTO client_services (id, client_id, service, active_from)
    VALUES ('b-cs1', 'b-c1', 'vat_return', '2026-01-01')
  `);
  await db.execute(`
    INSERT INTO projects (id, client_service_id, client_id, service, state)
    VALUES ('b-t1', 'b-cs1', 'b-c1', 'vat_return', 'in_progress')
  `);
}

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  id: 'b-sl1',
  projectId: 'b-t1',
  service: 'vat_return',
  performedOn: new Date('2026-09-03T00:00:00.000Z'),
  userId: 'b-u1',
  worked: Duration.ofHours(2),
  pricing: { kind: 'hourly', perHour: aed(30_000) },
  entryIds: [],
  excluded: false,
  excludedReason: null,
  adjustedTo: null,
  adjustedReason: null,
  ...over,
});

function statementOf(lines: StatementLine[], id = 'b-s1') {
  const made = Statement.draft({
    id,
    clientId: 'b-c1',
    periodStart: new Date('2026-09-01T00:00:00.000Z'),
    periodEnd: new Date('2026-09-30T00:00:00.000Z'),
    currency: 'AED',
    lines,
    createdBy: 'b-u1',
    now: NOW,
  });
  if (!made.ok) throw made.error;
  return made.value;
}

describe('statements, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('survives a round trip, rates and all', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      const statement = statementOf([
        line({ id: 'b-sl1', pricing: { kind: 'hourly', perHour: aed(30_000) } }),
        line({
          id: 'b-sl2',
          pricing: { kind: 'hourly', perHour: aed(40_000) },
          worked: Duration.ofMinutes(90),
        }),
      ]);
      const repository = new DrizzleStatementRepository(db);
      await repository.save(statement);

      const back = await repository.findById('b-s1');
      expect(back?.total().minorUnits).toBe(120_000);
      expect(
        back
          ?.snapshot()
          .lines.map((l) => (l.pricing.kind === 'hourly' ? l.pricing.perHour.minorUnits : 0)),
      ).toEqual([30_000, 40_000]);
      expect(back?.totalWorked().seconds).toBe(3.5 * 3600);
    });
  });

  it('keeps an exclusion and its reason', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleStatementRepository(db);

      const statement = statementOf([line()]);
      statement.exclude('b-sl1', 'written off, client goodwill', NOW);
      await repository.save(statement);

      const back = await repository.findById('b-s1');
      expect(back?.total().isZero()).toBe(true);
      expect(back?.snapshot().lines[0]?.excludedReason).toBe('written off, client goodwill');
      // Still on the document, so the gap between worked and billed shows.
      expect(back?.totalAsWorked().minorUnits).toBe(60_000);
    });
  });

  it('refuses an exclusion with no reason, at the database', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await db.execute(`
        INSERT INTO statements (id, client_id, period_start, period_end, state, created_by)
        VALUES ('b-s9', 'b-c1', '2026-09-01', '2026-09-30', 'draft', 'b-u1')
      `);
      await expect(
        db.execute(`
          INSERT INTO statement_lines
            (id, statement_id, project_id, service, performed_on, worked_seconds,
             per_hour_minor, excluded, position)
          VALUES ('b-sl9', 'b-s9', 'b-t1', 'vat_return', '2026-09-03', 7200, 30000, true, 0)
        `),
      ).rejects.toThrow();
    });
  });

  it('updates lines in place rather than replacing them', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleStatementRepository(db);

      const statement = statementOf([line()]);
      await repository.save(statement);

      /*
       * Time entries point at statement lines. Deleting and reinserting on
       * every save would break that link and ON DELETE SET NULL would release
       * the hours back to the unbilled pool — to be billed again next month,
       * to a client who has already paid for them.
       */
      await db.execute(`
        INSERT INTO project_assignments (id, project_id, user_id, role, assigned_at, assigned_by)
        VALUES ('b-as1', 'b-t1', 'b-u1', 'responsible', '2026-01-01', 'b-u1')
      `);
      await db.execute(`
        INSERT INTO time_entries
          (id, assignment_id, started_at, ended_at, approved_at, approved_by, statement_line_id)
        VALUES ('b-e1', 'b-as1', '2026-09-03T06:00:00Z', '2026-09-03T08:00:00Z',
                '2026-09-04T06:00:00Z', 'b-u1', 'b-sl1')
      `);

      statement.exclude('b-sl1', 'written off after review', NOW);
      await repository.save(statement);

      const stillAttached = await db.execute<{ statement_line_id: string | null }>(
        `SELECT statement_line_id FROM time_entries WHERE id = 'b-e1'`,
      );
      expect(stillAttached[0]?.statement_line_id).toBe('b-sl1');

      // And the line knows which entries it is made of.
      const back = await repository.findById('b-s1');
      expect(back?.entryIds()).toEqual(['b-e1']);
    });
  });
});

describe('invoices, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  async function raised(db: Db) {
    const statements = new DrizzleStatementRepository(db);
    const statement = statementOf([line()]);
    statement.approve('b-u1', NOW);
    await statements.save(statement);

    const invoices = new DrizzleInvoiceRepository(db);
    const raise = new RaiseInvoice(
      statements,
      invoices,
      new DrizzleDocumentNumbering(db),
      { vatBasisPoints: 500, paymentTermsDays: 30 },
      new FakeClock(NOW),
      new CountingIds(),
    );
    const result = await raise.execute('b-u1', 'b-s1');
    if (!result.ok) throw result.error;
    return { invoices, statements, result };
  }

  it('raises one from an approved statement and reads it back', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const { invoices, result } = await raised(db);

      const invoice = await invoices.findById(result.value.invoiceId);
      expect(invoice?.net().minorUnits).toBe(60_000);
      expect(invoice?.vat().minorUnits).toBe(3_000);
      expect(invoice?.total().minorUnits).toBe(63_000);
      expect(invoice?.snapshot().number).toBe('2071');
      expect(invoice?.snapshot().lines[0]?.projectId).toBe('b-t1');
    });
  });

  it('records a payment and settles', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const { invoices, result } = await raised(db);

      const invoice = await invoices.findById(result.value.invoiceId);
      if (!invoice) throw new Error('missing');

      invoice.recordPayment({
        id: 'b-p1',
        amount: aed(20_000),
        receivedOn: new Date('2026-10-10T00:00:00Z'),
        method: 'bank_transfer',
        reference: 'FT123',
        chequeNumber: null,
        chequeDate: null,
        bankName: null,
        discount: Money.zero('AED'),
        discountReason: null,
        recordedBy: 'b-u1',
      });
      await invoices.save(invoice);

      const back = await invoices.findById(result.value.invoiceId);
      expect(back?.status()).toBe('part_paid');
      expect(back?.balance().minorUnits).toBe(43_000);
    });
  });

  it('finds what is late, and ignores what is settled', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const { invoices, result } = await raised(db);

      // Due 31 October. Nothing is late on the 15th.
      expect(await invoices.lateAsOf(new Date('2026-10-15T00:00:00Z'), 10)).toHaveLength(0);

      const late = await invoices.lateAsOf(new Date('2026-11-05T00:00:00Z'), 10);
      expect(late.map((invoice) => invoice.id)).toEqual([result.value.invoiceId]);

      const invoice = late[0];
      if (!invoice) throw new Error('missing');
      invoice.recordPayment({
        id: 'b-p2',
        amount: aed(63_000),
        receivedOn: new Date('2026-11-06T00:00:00Z'),
        method: 'cash',
        reference: null,
        chequeNumber: null,
        chequeDate: null,
        bankName: null,
        discount: Money.zero('AED'),
        discountReason: null,
        recordedBy: 'b-u1',
      });
      await invoices.save(invoice);

      expect(await invoices.lateAsOf(new Date('2026-11-07T00:00:00Z'), 10)).toHaveLength(0);
    });
  });

  it('will not put two documents under one number', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await raised(db);

      await expect(
        db.execute(`
          INSERT INTO invoices
            (id, client_id, statement_id, number, settlement, currency,
             vat_basis_points, issued_on, due_on, issued_by)
          VALUES ('b-inv9', 'b-c1', 'b-s1', '2071', 'issued', 'AED',
                  500, now(), now() + interval '30 days', 'b-u1')
        `),
      ).rejects.toThrow();
    });
  });
});

describe('the invoice sequence', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('continues the firm\u2019s own numbering rather than restarting', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      const numbering = new DrizzleDocumentNumbering(db);

      // Seeded by migration 0029 one past the last invoice issued by hand.
      // A restart at 1 would put invoice 1 in a file that already holds 2070.
      expect(await numbering.next()).toBe('2071');
      expect(await numbering.next()).toBe('2072');

      // Quotations run their own sequence, from their own last number.
      const quotations = new DrizzleDocumentNumbering(db, 'quotation');
      expect(await quotations.next()).toBe('193');
      expect(await numbering.next()).toBe('2073');
    });
  });

  it('never hands the same number to two callers at once', async () => {
    /*
     * Outside a rollback transaction on purpose: the point is genuine
     * concurrency, and two statements inside one transaction cannot contend.
     * Reading the highest number and adding one would give both callers the
     * same answer, and a number handed out twice cannot be undone — the
     * client has both documents.
     */
    const before = await database.sql<{ next_value: number }[]>`
      SELECT next_value FROM document_numbers WHERE kind = 'invoice'
    `;
    const start = Number(before[0]?.next_value ?? 0);

    const results = await Promise.all(
      Array.from(
        { length: 20 },
        () =>
          database.sql<{ next_value: number }[]>`
          UPDATE document_numbers
          SET next_value = next_value + 1, updated_at = now()
          WHERE kind = 'invoice'
          RETURNING next_value - 1 AS next_value
        `,
      ),
    );

    const handed = results.map((rows) => Number(rows[0]?.next_value)).sort((a, b) => a - b);
    expect(new Set(handed).size).toBe(20);
    expect(handed).toEqual(Array.from({ length: 20 }, (_, index) => start + index));

    await database.sql`
      UPDATE document_numbers SET next_value = ${start} WHERE kind = 'invoice'
    `;
  });
});
