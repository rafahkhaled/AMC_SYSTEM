import { clientCycleFrom } from '@amc/clients/domain';
import type { Database } from '@amc/database';
import type { ClientCycle } from '@amc/projects';
import { sql } from 'drizzle-orm';

/**
 * Each client's own filing cycles, read once for a sweep.
 *
 * The services module is told these rather than reading the clients tables
 * itself, which keeps the two modules out of each other. The composition
 * happens here, in the worker, because the worker is the one thing allowed to
 * know about both. What a cycle *is* lives in the clients module, so the API
 * can build the same one.
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

  return new Map(rows.map((row) => [row.id, clientCycleFrom(row)]));
}
