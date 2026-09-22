import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import { Duration, Money } from '@amc/kernel';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RaiseInvoice } from '../application/raise-invoice.js';
import { CountingIds, FakeClock } from '../application/test-doubles.js';
import { Statement, type StatementLine } from '../domain/index.js';
import { DrizzleDocumentNumbering, DrizzleInvoiceRepository } from './invoice.repository.js';
import { DrizzleReportReader } from './reports.reader.js';
import { DrizzleStatementRepository } from './statement.repository.js';

type Db = ReturnType<typeof drizzle>;

const NOW = new Date('2026-10-01T08:00:00.000Z');
const FROM = new Date('2026-09-01T00:00:00.000Z');
const TO = new Date('2026-10-01T00:00:00.000Z');
const aed = (minor: number) => Money.ofMinor(minor, 'AED');
const ALL = { kind: 'all' } as const;

async function world(db: Db): Promise<void> {
  await db.execute(`
    INSERT INTO users (id, email, display_name, password_hash) VALUES
      ('rp-hana', 'hana@activemanagement.ae', 'Hana Saeed', 'x'),
      ('rp-omar', 'omar@activemanagement.ae', 'Omar Nasser', 'x')
  `);
  await db.execute(`
    INSERT INTO clients (id, legal_name) VALUES
      ('rp-gulf', 'Gulf Trading LLC'), ('rp-delta', 'Delta Services')
  `);
  await db.execute(`
    INSERT INTO client_rates (id, client_id, per_hour_minor, effective_from, changed_by) VALUES
      ('rp-r1', 'rp-gulf', 30000, '2026-01-01', 'rp-hana'),
      ('rp-r2', 'rp-delta', 40000, '2026-01-01', 'rp-hana')
  `);
  for (const [cs, client, pricing, fee] of [
    ['rp-cs-gulf', 'rp-gulf', 'fixed', '175000'],
    ['rp-cs-delta', 'rp-delta', 'hourly', 'NULL'],
  ] as const) {
    await db.execute(
      `INSERT INTO client_services (id, client_id, service, active_from, pricing, fee_minor)
       VALUES ('${cs}', '${client}', 'vat_return', '2026-01-01', '${pricing}', ${fee})`,
    );
  }
  for (const [project, cs, client] of [
    ['rp-p-gulf', 'rp-cs-gulf', 'rp-gulf'],
    ['rp-p-delta', 'rp-cs-delta', 'rp-delta'],
  ] as const) {
    await db.execute(
      `INSERT INTO projects (id, client_service_id, client_id, service, state)
       VALUES ('${project}', '${cs}', '${client}', 'vat_return', 'in_progress')`,
    );
  }
  await db.execute(`
    INSERT INTO project_assignments (id, project_id, user_id, role, assigned_at, assigned_by) VALUES
      ('rp-a-gulf', 'rp-p-gulf', 'rp-hana', 'responsible', '2026-01-01', 'rp-hana'),
      ('rp-a-delta', 'rp-p-delta', 'rp-omar', 'responsible', '2026-01-01', 'rp-hana')
  `);
}

async function record(
  db: Db,
  id: string,
  assignment: string,
  from: string,
  to: string,
): Promise<void> {
  await db.execute(`
    INSERT INTO time_entries
      (id, assignment_id, started_at, ended_at, billable, approved_at, approved_by)
    VALUES ('${id}', '${assignment}', '${from}', '${to}', true, '2026-09-30T06:00:00Z', 'rp-hana')
  `);
}

describe('the hours report, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('splits recorded hours into billed and unbilled', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      // Four hours for Gulf, two of them billed.
      await record(db, 'rp-e1', 'rp-a-gulf', '2026-09-03T06:00:00Z', '2026-09-03T08:00:00Z');
      await record(db, 'rp-e2', 'rp-a-gulf', '2026-09-04T06:00:00Z', '2026-09-04T08:00:00Z');

      const statements = new DrizzleStatementRepository(db);
      const line: StatementLine = {
        id: 'rp-l1',
        projectId: 'rp-p-gulf',
        service: 'vat_return',
        performedOn: new Date('2026-09-03T00:00:00.000Z'),
        userId: 'rp-hana',
        worked: Duration.ofHours(2),
        pricing: { kind: 'fixed', fee: aed(175_000) },
        entryIds: ['rp-e1'],
        excluded: false,
        excludedReason: null,
        adjustedTo: null,
        adjustedReason: null,
      };
      const statement = Statement.draft({
        id: 'rp-s1',
        clientId: 'rp-gulf',
        periodStart: FROM,
        periodEnd: new Date('2026-09-30T00:00:00.000Z'),
        currency: 'AED',
        lines: [line],
        createdBy: 'rp-hana',
        now: NOW,
      });
      if (!statement.ok) throw statement.error;
      await statements.save(statement.value);
      await db.execute(`UPDATE time_entries SET statement_line_id = 'rp-l1' WHERE id = 'rp-e1'`);

      const report = await new DrizzleReportReader(db).hours(ALL, {
        from: FROM,
        to: TO,
        by: 'client',
      });
      const gulf = report.rows.find((row) => row.key === 'rp-gulf');

      expect(gulf?.recordedSeconds).toBe(4 * 3600);
      expect(gulf?.billedSeconds).toBe(2 * 3600);
      // The split is the point: unbilled is either work in progress or work
      // quietly given away, and a practice cannot tell which without looking.
      expect(gulf?.unbilledSeconds).toBe(2 * 3600);
      expect(gulf?.billedAmount.minorUnits).toBe(175_000);
    });
  });

  it('counts a fee once, however many entries make up its line', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      await record(db, 'rp-e1', 'rp-a-gulf', '2026-09-03T06:00:00Z', '2026-09-03T08:00:00Z');
      await record(db, 'rp-e2', 'rp-a-gulf', '2026-09-04T06:00:00Z', '2026-09-04T09:00:00Z');

      await db.execute(`
        INSERT INTO statements (id, client_id, period_start, period_end, state, created_by)
        VALUES ('rp-s1', 'rp-gulf', '2026-09-01', '2026-09-30', 'draft', 'rp-hana')
      `);
      await db.execute(`
        INSERT INTO statement_lines
          (id, statement_id, project_id, service, performed_on, user_id,
           worked_seconds, pricing, fee_minor, position)
        VALUES ('rp-l1', 'rp-s1', 'rp-p-gulf', 'vat_return', '2026-09-03', 'rp-hana',
                18000, 'fixed', 175000, 0)
      `);
      await db.execute(`UPDATE time_entries SET statement_line_id = 'rp-l1'`);

      const report = await new DrizzleReportReader(db).hours(ALL, {
        from: FROM,
        to: TO,
        by: 'client',
      });

      // Two entries, one line, one fee. Counting per entry would report 350000.
      expect(report.rows[0]?.billedAmount.minorUnits).toBe(175_000);
      expect(report.rows[0]?.billedSeconds).toBe(5 * 3600);
    });
  });

  it('groups by person, and by service', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await record(db, 'rp-e1', 'rp-a-gulf', '2026-09-03T06:00:00Z', '2026-09-03T08:00:00Z');
      await record(db, 'rp-e2', 'rp-a-delta', '2026-09-03T06:00:00Z', '2026-09-03T07:00:00Z');

      const reader = new DrizzleReportReader(db);
      const byPerson = await reader.hours(ALL, { from: FROM, to: TO, by: 'person' });
      expect(byPerson.rows.map((row) => row.label).sort()).toEqual(['Hana Saeed', 'Omar Nasser']);

      const byService = await reader.hours(ALL, { from: FROM, to: TO, by: 'service' });
      expect(byService.rows).toHaveLength(1);
      expect(byService.rows[0]?.recordedSeconds).toBe(3 * 3600);
    });
  });

  it('leaves out hours outside the period, and hours nobody approved', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await record(db, 'rp-in', 'rp-a-gulf', '2026-09-15T06:00:00Z', '2026-09-15T08:00:00Z');
      await record(db, 'rp-before', 'rp-a-gulf', '2026-08-15T06:00:00Z', '2026-08-15T08:00:00Z');
      await db.execute(`
        INSERT INTO time_entries (id, assignment_id, started_at, ended_at, billable)
        VALUES ('rp-unapproved', 'rp-a-gulf', '2026-09-16T06:00:00Z', '2026-09-16T09:00:00Z', true)
      `);

      const report = await new DrizzleReportReader(db).hours(ALL, {
        from: FROM,
        to: TO,
        by: 'client',
      });
      expect(report.totals.recordedSeconds).toBe(2 * 3600);
    });
  });

  it('shows an accountant their own clients only', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await db.execute(`
        INSERT INTO client_staff_access (client_id, user_id, assigned_by)
        VALUES ('rp-gulf', 'rp-hana', 'rp-hana')
      `);
      await record(db, 'rp-e1', 'rp-a-gulf', '2026-09-03T06:00:00Z', '2026-09-03T08:00:00Z');
      await record(db, 'rp-e2', 'rp-a-delta', '2026-09-03T06:00:00Z', '2026-09-03T07:00:00Z');

      const reader = new DrizzleReportReader(db);
      // A report is a faster way to read the same rows, not a way around who
      // may see them.
      const hana = await reader.hours(
        { kind: 'assigned', userId: 'rp-hana' },
        { from: FROM, to: TO, by: 'client' },
      );
      expect(hana.rows.map((row) => row.key)).toEqual(['rp-gulf']);
      expect(
        (await reader.hours({ kind: 'none' }, { from: FROM, to: TO, by: 'client' })).rows,
      ).toEqual([]);
    });
  });
});

describe('profitability, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('works out what an hour actually earned', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      // Twelve hours of work, billed at a fixed fee of 1,750.
      await record(db, 'rp-e1', 'rp-a-gulf', '2026-09-03T06:00:00Z', '2026-09-03T18:00:00Z');

      const statements = new DrizzleStatementRepository(db);
      const statement = Statement.draft({
        id: 'rp-s1',
        clientId: 'rp-gulf',
        periodStart: FROM,
        periodEnd: new Date('2026-09-30T00:00:00.000Z'),
        currency: 'AED',
        lines: [
          {
            id: 'rp-l1',
            projectId: 'rp-p-gulf',
            service: 'vat_return',
            performedOn: new Date('2026-09-03T00:00:00.000Z'),
            userId: 'rp-hana',
            worked: Duration.ofHours(12),
            pricing: { kind: 'fixed', fee: aed(175_000) },
            entryIds: ['rp-e1'],
            excluded: false,
            excludedReason: null,
            adjustedTo: null,
            adjustedReason: null,
          },
        ],
        createdBy: 'rp-hana',
        now: NOW,
      });
      if (!statement.ok) throw statement.error;
      statement.value.approve('rp-hana', NOW);
      await statements.save(statement.value);

      const invoices = new DrizzleInvoiceRepository(db);
      const raised = await new RaiseInvoice(
        statements,
        invoices,
        new DrizzleDocumentNumbering(db),
        { vatBasisPoints: 0, paymentTermsDays: 30 },
        new FakeClock(new Date('2026-09-30T08:00:00.000Z')),
        new CountingIds(),
      ).execute('rp-hana', 'rp-s1');
      if (!raised.ok) throw raised.error;

      const report = await new DrizzleReportReader(db).profitability(ALL, {
        from: FROM,
        to: TO,
      });
      const gulf = report.rows.find((row) => row.clientId === 'rp-gulf');

      expect(gulf?.recordedSeconds).toBe(12 * 3600);
      expect(gulf?.netInvoiced.minorUnits).toBe(175_000);
      // 1,750 over twelve hours is 145.83 an hour, against a standard of 300.
      // Nothing else on this report says so as plainly.
      expect(gulf?.effectivePerHour?.minorUnits).toBe(14_583);
      expect(gulf?.standardPerHour.minorUnits).toBe(30_000);
      expect(gulf?.outstanding.minorUnits).toBe(175_000);
    });
  });

  it('takes payment off what is outstanding', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await record(db, 'rp-e1', 'rp-a-gulf', '2026-09-03T06:00:00Z', '2026-09-03T08:00:00Z');
      await db.execute(`
        INSERT INTO statements (id, client_id, period_start, period_end, state, created_by,
                                approved_at, approved_by)
        VALUES ('rp-s1', 'rp-gulf', '2026-09-01', '2026-09-30', 'invoiced', 'rp-hana',
                now(), 'rp-hana')
      `);
      await db.execute(`
        INSERT INTO invoices (id, client_id, statement_id, number, settlement, currency,
                              vat_basis_points, issued_on, due_on, issued_by)
        VALUES ('rp-i1', 'rp-gulf', 'rp-s1', '2071', 'part_paid', 'AED', 500,
                '2026-09-20T08:00:00Z', '2026-10-20T08:00:00Z', 'rp-hana')
      `);
      await db.execute(`
        INSERT INTO invoice_lines (id, invoice_id, project_id, service, description_en,
                                   description_ar, worked_seconds, amount_minor, position)
        VALUES ('rp-il1', 'rp-i1', 'rp-p-gulf', 'vat_return', 'VAT return', 'الإقرار',
                7200, 175000, 0)
      `);
      await db.execute(`
        INSERT INTO payments (id, invoice_id, amount_minor, currency, received_on, method, recorded_by)
        VALUES ('rp-pay1', 'rp-i1', 75000, 'AED', '2026-09-25T08:00:00Z', 'bank_transfer', 'rp-hana')
      `);

      const report = await new DrizzleReportReader(db).profitability(ALL, { from: FROM, to: TO });
      const gulf = report.rows.find((row) => row.clientId === 'rp-gulf');

      // 1,750.00 net, 1,837.50 to pay, 750.00 received. What is still owed is
      // measured against the total the client was given, not against the fee:
      // netting it off the fee alone would understate the debt by the VAT.
      expect(gulf?.netInvoiced.minorUnits).toBe(175_000);
      expect(gulf?.grossInvoiced.minorUnits).toBe(183_750);
      expect(gulf?.paid.minorUnits).toBe(75_000);
      expect(gulf?.outstanding.minorUnits).toBe(108_750);
    });
  });

  it('measures what is outstanding against the VAT-inclusive total', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await record(db, 'rp-e1', 'rp-a-gulf', '2026-09-03T06:00:00Z', '2026-09-03T08:00:00Z');
      await db.execute(`
        INSERT INTO statements (id, client_id, period_start, period_end, state, created_by,
                                approved_at, approved_by)
        VALUES ('rp-s1', 'rp-gulf', '2026-09-01', '2026-09-30', 'invoiced', 'rp-hana',
                now(), 'rp-hana')
      `);
      // 1,300.00 net at 5 per cent is 1,365.00 to pay.
      await db.execute(`
        INSERT INTO invoices (id, client_id, statement_id, number, settlement, currency,
                              vat_basis_points, issued_on, due_on, issued_by)
        VALUES ('rp-i1', 'rp-gulf', 'rp-s1', '2071', 'paid', 'AED', 500,
                '2026-09-20T08:00:00Z', '2026-10-20T08:00:00Z', 'rp-hana')
      `);
      await db.execute(`
        INSERT INTO invoice_lines (id, invoice_id, project_id, service, description_en,
                                   description_ar, worked_seconds, amount_minor, position)
        VALUES ('rp-il1', 'rp-i1', 'rp-p-gulf', 'vat_return', 'VAT return', 'الإقرار',
                7200, 130000, 0)
      `);
      await db.execute(`
        INSERT INTO payments (id, invoice_id, amount_minor, currency, received_on, method, recorded_by)
        VALUES ('rp-pay1', 'rp-i1', 136500, 'AED', '2026-09-25T08:00:00Z', 'bank_transfer', 'rp-hana')
      `);

      const report = await new DrizzleReportReader(db).profitability(ALL, { from: FROM, to: TO });
      const gulf = report.rows.find((row) => row.clientId === 'rp-gulf');

      // The client paid the invoice exactly. Comparing the net fee with the
      // VAT-inclusive payment made that look like an overpayment of 65.00.
      expect(gulf?.netInvoiced.minorUnits).toBe(130_000);
      expect(gulf?.grossInvoiced.minorUnits).toBe(136_500);
      expect(gulf?.paid.minorUnits).toBe(136_500);
      expect(gulf?.outstanding.minorUnits).toBe(0);
      // The VAT is not the firm's, so it stays out of the rate: 1,300 over
      // two hours is 650, not 682.50.
      expect(gulf?.effectivePerHour?.minorUnits).toBe(65_000);
    });
  });

  it('leaves the rate empty when nobody recorded any time', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await db.execute(`
        INSERT INTO statements (id, client_id, period_start, period_end, state, created_by,
                                approved_at, approved_by)
        VALUES ('rp-s1', 'rp-gulf', '2026-09-01', '2026-09-30', 'invoiced', 'rp-hana',
                now(), 'rp-hana')
      `);
      await db.execute(`
        INSERT INTO invoices (id, client_id, statement_id, number, settlement, currency,
                              vat_basis_points, issued_on, due_on, issued_by)
        VALUES ('rp-i1', 'rp-gulf', 'rp-s1', '2071', 'issued', 'AED', 0,
                '2026-09-20T08:00:00Z', '2026-10-20T08:00:00Z', 'rp-hana')
      `);
      await db.execute(`
        INSERT INTO invoice_lines (id, invoice_id, project_id, service, description_en,
                                   description_ar, worked_seconds, amount_minor, position)
        VALUES ('rp-il1', 'rp-i1', 'rp-p-gulf', 'vat_return', 'VAT return', 'الإقرار',
                0, 175000, 0)
      `);

      const report = await new DrizzleReportReader(db).profitability(ALL, { from: FROM, to: TO });
      const gulf = report.rows.find((row) => row.clientId === 'rp-gulf');

      // Dividing by nothing produces a figure that looks like a triumph.
      expect(gulf?.effectivePerHour).toBeNull();
      expect(gulf?.netInvoiced.minorUnits).toBe(175_000);
    });
  });

  it('leaves out a cancelled invoice', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await record(db, 'rp-e1', 'rp-a-gulf', '2026-09-03T06:00:00Z', '2026-09-03T08:00:00Z');
      await db.execute(`
        INSERT INTO statements (id, client_id, period_start, period_end, state, created_by,
                                approved_at, approved_by)
        VALUES ('rp-s1', 'rp-gulf', '2026-09-01', '2026-09-30', 'invoiced', 'rp-hana',
                now(), 'rp-hana')
      `);
      await db.execute(`
        INSERT INTO invoices (id, client_id, statement_id, number, settlement, currency,
                              vat_basis_points, issued_on, due_on, issued_by, cancelled_reason)
        VALUES ('rp-i1', 'rp-gulf', 'rp-s1', '2071', 'cancelled', 'AED', 0,
                '2026-09-20T08:00:00Z', '2026-10-20T08:00:00Z', 'rp-hana', 'wrong client')
      `);
      await db.execute(`
        INSERT INTO invoice_lines (id, invoice_id, project_id, service, description_en,
                                   description_ar, worked_seconds, amount_minor, position)
        VALUES ('rp-il1', 'rp-i1', 'rp-p-gulf', 'vat_return', 'VAT return', 'الإقرار',
                7200, 175000, 0)
      `);

      const report = await new DrizzleReportReader(db).profitability(ALL, { from: FROM, to: TO });
      const gulf = report.rows.find((row) => row.clientId === 'rp-gulf');

      // A cancelled invoice was never earned. Counting it would make a month
      // of undone work look like the best one this year.
      expect(gulf?.netInvoiced.minorUnits).toBe(0);
    });
  });
});
