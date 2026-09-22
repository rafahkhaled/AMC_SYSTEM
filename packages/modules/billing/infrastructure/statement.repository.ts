import { type CurrencyCode, Duration, Money } from '@amc/kernel';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { StatementRepository } from '../application/ports.js';
import { Statement, type StatementLine, type StatementState } from '../domain/index.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/** A timestamp out of raw SQL is a string, not a Date. */
function at(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

/** A date column, read as UTC midnight — how every calendar day here is keyed. */
function onDay(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

type StatementRow = {
  id: string;
  client_id: string;
  period_start: string;
  period_end: string;
  state: string;
  currency: string;
  created_by: string;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
};

type LineRow = {
  id: string;
  project_id: string;
  service: string;
  performed_on: string;
  user_id: string | null;
  worked_seconds: number;
  pricing: string;
  per_hour_minor: string | null;
  fee_minor: string | null;
  excluded: boolean;
  excluded_reason: string | null;
  adjusted_to_minor: string | null;
  adjusted_reason: string | null;
  entry_ids: string[] | null;
};

export class DrizzleStatementRepository implements StatementRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Statement | null> {
    const rows = await this.db.execute<StatementRow>(sql`
      SELECT * FROM statements WHERE id = ${id} LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;

    const currency = row.currency as CurrencyCode;

    /*
     * The entry ids come back with the line, aggregated.
     *
     * Time entries belong to another module, and this is the one place billing
     * has to know which of them a line is made of — because releasing them is
     * what cancelling a statement means. Aggregating in the query rather than
     * a second round trip per line keeps a statement one query deep.
     */
    const lineRows = await this.db.execute<LineRow>(sql`
      SELECT l.*,
             array_remove(array_agg(e.id), NULL) AS entry_ids
      FROM statement_lines l
      LEFT JOIN time_entries e ON e.statement_line_id = l.id
      WHERE l.statement_id = ${id}
      GROUP BY l.id
      ORDER BY l.position
    `);

    const lines: StatementLine[] = lineRows.map((line) => ({
      id: line.id,
      projectId: line.project_id,
      service: line.service,
      performedOn: onDay(line.performed_on),
      userId: line.user_id,
      worked: Duration.ofSeconds(line.worked_seconds),
      pricing:
        line.pricing === 'fixed'
          ? { kind: 'fixed', fee: Money.ofMinor(Number(line.fee_minor ?? 0), currency) }
          : { kind: 'hourly', perHour: Money.ofMinor(Number(line.per_hour_minor ?? 0), currency) },
      entryIds: line.entry_ids ?? [],
      excluded: line.excluded,
      excludedReason: line.excluded_reason,
      adjustedTo:
        line.adjusted_to_minor === null
          ? null
          : Money.ofMinor(Number(line.adjusted_to_minor), currency),
      adjustedReason: line.adjusted_reason,
    }));

    return Statement.rehydrate({
      id: row.id,
      clientId: row.client_id,
      periodStart: onDay(row.period_start),
      periodEnd: onDay(row.period_end),
      state: row.state as StatementState,
      currency,
      lines,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      approvedAt: at(row.approved_at),
      approvedBy: row.approved_by,
    });
  }

  /**
   * Writes the statement and its lines.
   *
   * Lines are updated in place rather than replaced, because `time_entries`
   * points at them: deleting and reinserting would break that link, and
   * `ON DELETE SET NULL` would quietly release every hour on the statement
   * back into the unbilled pool — to be billed again next month, to a client
   * who has already paid for them.
   */
  async save(statement: Statement): Promise<void> {
    const state = statement.snapshot();

    await this.db.execute(sql`
      INSERT INTO statements
        (id, client_id, period_start, period_end, state, currency,
         created_by, approved_at, approved_by, created_at)
      VALUES (
        ${state.id}, ${state.clientId},
        ${state.periodStart.toISOString().slice(0, 10)},
        ${state.periodEnd.toISOString().slice(0, 10)},
        ${state.state}, ${state.currency}, ${state.createdBy},
        ${state.approvedAt?.toISOString() ?? null}, ${state.approvedBy},
        ${state.createdAt.toISOString()}
      )
      ON CONFLICT (id) DO UPDATE SET
        state       = excluded.state,
        approved_at = excluded.approved_at,
        approved_by = excluded.approved_by
    `);

    for (const [position, line] of state.lines.entries()) {
      await this.db.execute(sql`
        INSERT INTO statement_lines
          (id, statement_id, project_id, service, performed_on, user_id,
           worked_seconds, pricing, per_hour_minor, fee_minor, excluded,
           excluded_reason, adjusted_to_minor, adjusted_reason, position)
        VALUES (
          ${line.id}, ${state.id}, ${line.projectId}, ${line.service},
          ${line.performedOn.toISOString().slice(0, 10)}, ${line.userId},
          ${line.worked.seconds}, ${line.pricing.kind},
          ${line.pricing.kind === 'hourly' ? line.pricing.perHour.minorUnits : null},
          ${line.pricing.kind === 'fixed' ? line.pricing.fee.minorUnits : null},
          ${line.excluded}, ${line.excludedReason},
          ${line.adjustedTo?.minorUnits ?? null}, ${line.adjustedReason},
          ${position}
        )
        ON CONFLICT (id) DO UPDATE SET
          excluded          = excluded.excluded,
          excluded_reason   = excluded.excluded_reason,
          adjusted_to_minor = excluded.adjusted_to_minor,
          adjusted_reason   = excluded.adjusted_reason,
          position          = excluded.position
      `);
    }
  }
}
