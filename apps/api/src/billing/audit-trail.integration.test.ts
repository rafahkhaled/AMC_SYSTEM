import { DrizzleUnitOfWork } from '@amc/audit/infrastructure';
import { Statement, type StatementLine } from '@amc/billing/domain';
import { DrizzleStatementRepository } from '@amc/billing/infrastructure';
import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { Actor, EventCollector } from '@amc/kernel';
import { Duration, Money } from '@amc/kernel';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Db = ReturnType<typeof drizzle>;

const WAEL: Actor = { userId: 'at-wael', roles: ['manager'], label: 'Wael Ajam' };
const NOW = new Date('2026-09-24T08:00:00.000Z');
const aed = (minor: number) => Money.ofMinor(minor, 'AED');

let counter = 0;
const ids = { next: () => `at-${++counter}` };

async function world(db: Db): Promise<void> {
  await db.execute(`
    INSERT INTO users (id, email, display_name, password_hash)
    VALUES ('at-wael', 'wael@activemanagement.ae', 'Wael Ajam', 'x')
  `);
  await db.execute(`INSERT INTO clients (id, legal_name) VALUES ('at-gulf', 'Gulf Trading LLC')`);
  // A statement line points at real work; the foreign key says so.
  await db.execute(`
    INSERT INTO client_services (id, client_id, service, active_from)
    VALUES ('at-cs1', 'at-gulf', 'vat_return', '2026-01-01')
  `);
  await db.execute(`
    INSERT INTO projects (id, client_service_id, client_id, service, state)
    VALUES ('at-p1', 'at-cs1', 'at-gulf', 'vat_return', 'in_progress')
  `);
}

function statement(): Statement {
  const line: StatementLine = {
    id: 'at-l1',
    projectId: 'at-p1',
    service: 'vat_return',
    performedOn: new Date('2026-09-03T00:00:00.000Z'),
    userId: 'at-wael',
    worked: Duration.ofHours(2),
    pricing: { kind: 'hourly', perHour: aed(30_000) },
    entryIds: ['at-e1'],
    excluded: false,
    excludedReason: null,
    adjustedTo: null,
    adjustedReason: null,
  };
  const made = Statement.draft({
    id: 'at-s1',
    clientId: 'at-gulf',
    periodStart: new Date('2026-09-01T00:00:00.000Z'),
    periodEnd: new Date('2026-09-30T00:00:00.000Z'),
    currency: 'AED',
    lines: [line],
    createdBy: 'at-wael',
    now: NOW,
  });
  if (!made.ok) throw made.error;
  return made.value;
}

/**
 * Billing, in the trail.
 *
 * Here rather than in the billing module because it is the composition root
 * that wires a module to the audit trail, and billing may not reach into the
 * audit module to find out whether it worked.
 *
 * Every other module's writes were in `audit_log` and this one's were not —
 * not one `billing.*` row had ever been written, for the whole of P2. The
 * aggregates recorded their events correctly and the repositories dropped
 * them, because they were built with no collector and nothing wrapped them in
 * a transaction.
 *
 * Nothing caught it because every test asserted on the event the aggregate
 * produced, which was true and said nothing about where it ended up, or on
 * the billing tables, which were right. So these read the trail instead: the
 * question is not "did it save" but "can the firm say who did it".
 */
describe('what billing writes to the audit log', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('records an approval against the person who approved it', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      await new DrizzleUnitOfWork(db as never, ids, { now: () => NOW }).run(
        WAEL,
        async (context) => {
          const statements = new DrizzleStatementRepository(
            (context as unknown as { db: Db }).db,
            context as unknown as EventCollector,
          );
          const draft = statement();
          draft.approve('at-wael', NOW);
          await statements.save(draft);
        },
      );

      const rows = await db.execute<{
        action: string;
        actor_user_id: string | null;
        actor_label: string | null;
        entity_id: string;
      }>(`SELECT action, actor_user_id, actor_label, entity_id FROM audit_log
          WHERE action LIKE 'billing.%' ORDER BY occurred_at`);

      // The row that was missing for a whole phase.
      expect(rows.map((row) => row.action)).toContain('billing.statement.approved');
      const approved = rows.find((row) => row.action === 'billing.statement.approved');
      expect(approved?.actor_user_id).toBe('at-wael');
      expect(approved?.actor_label).toBe('Wael Ajam');
      expect(approved?.entity_id).toBe('at-s1');
    });
  });

  it('keeps the reason on a line somebody wrote off', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      await new DrizzleUnitOfWork(db as never, ids, { now: () => NOW }).run(
        WAEL,
        async (context) => {
          const statements = new DrizzleStatementRepository(
            (context as unknown as { db: Db }).db,
            context as unknown as EventCollector,
          );
          const draft = statement();
          draft.exclude('at-l1', 'written off, client goodwill', NOW);
          await statements.save(draft);
        },
      );

      const [revised] = await db.execute<{ after: Record<string, unknown> }>(
        `SELECT after FROM audit_log WHERE action = 'billing.statement.line_revised'`,
      );

      /*
       * The reason, not just the fact.
       *
       * "Somebody reduced this bill" is not the answer anybody wants three
       * months later; "somebody reduced this bill, and said why" is.
       */
      expect(revised?.after).toMatchObject({ reason: 'written off, client goodwill' });
    });
  });

  it('writes nothing at all when the change is refused', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      await new DrizzleUnitOfWork(db as never, ids, { now: () => NOW })
        .run(WAEL, async (context) => {
          const statements = new DrizzleStatementRepository(
            (context as unknown as { db: Db }).db,
            context as unknown as EventCollector,
          );
          const draft = statement();
          draft.approve('at-wael', NOW);
          await statements.save(draft);
          throw new Error('something went wrong after the save');
        })
        .catch(() => undefined);

      // The audit row and the change commit together or not at all, which is
      // the property that makes the trail worth reading.
      const rows = await db.execute<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_log WHERE action LIKE 'billing.%'`,
      );
      expect(rows[0]?.count).toBe('0');
    });
  });
});
