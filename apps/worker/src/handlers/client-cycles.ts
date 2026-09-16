import { FinancialYear, type VatFrequency, VatPeriods } from '@amc/clients/domain';
import type { Database } from '@amc/database';
import type { ClientCycle } from '@amc/services';
import { sql } from 'drizzle-orm';

/**
 * Each client's own filing cycles, read once for a sweep.
 *
 * The services module is told these rather than reading the clients tables
 * itself, which keeps the two modules out of each other. The composition
 * happens here, in the worker, because the worker is the one thing allowed to
 * know about both.
 */
export async function loadClientCycles(db: Database): Promise<Map<string, ClientCycle>> {
  const rows = await db.execute<{
    id: string;
    vat_frequency: string | null;
    vat_anchor_end_month: number | null;
    financial_year_end_month: number | null;
  }>(sql`
    SELECT id, vat_frequency, vat_anchor_end_month, financial_year_end_month
    FROM clients
    WHERE status <> 'closed'
      AND (vat_state = 'registered' OR ct_state = 'registered')
  `);

  const cycles = new Map<string, ClientCycle>();

  for (const row of rows) {
    const cycle: {
      clientId: string;
      vatPeriodFor?: (date: Date) => { start: Date; end: Date; key: string };
      financialYearEndFor?: (date: Date) => Date;
      financialYearKeyFor?: (date: Date) => string;
    } = { clientId: row.id };

    if (row.vat_frequency && row.vat_anchor_end_month !== null) {
      const periods = VatPeriods.of(row.vat_frequency as VatFrequency, row.vat_anchor_end_month);
      // A malformed row is skipped rather than guessed at. Guessing a VAT
      // quarter produces a confidently wrong filing date, which is worse than
      // no date at all.
      if (periods.ok) {
        cycle.vatPeriodFor = (date: Date) => periods.value.periodContaining(date);
      }
    }

    if (row.financial_year_end_month !== null) {
      const year = FinancialYear.endingIn(row.financial_year_end_month);
      if (year.ok) {
        cycle.financialYearEndFor = (date: Date) => year.value.yearEndFor(date);
        cycle.financialYearKeyFor = (date: Date) => year.value.keyFor(date);
      }
    }

    cycles.set(row.id, cycle);
  }

  return cycles;
}
