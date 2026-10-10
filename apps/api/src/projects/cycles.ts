import { clientCycleFrom } from '@amc/clients/domain';
import type { Database } from '@amc/database';
import type { ClientCycleReader } from '@amc/projects';
import { sql } from 'drizzle-orm';

/**
 * One client's filing cycle, asked for when somebody opens their next job.
 *
 * The same builder the worker's morning sweep uses, deliberately: a project
 * opened by hand has to carry the key the sweep would have given that period,
 * or the sweep would open it a second time when the period closed.
 */
export function clientCycles(db: Database): ClientCycleReader {
  return {
    async cycleFor(clientId) {
      const [row] = await db.execute<{
        id: string;
        vat_frequency: string | null;
        vat_anchor_end_month: number | null;
        financial_year_end_month: number | null;
      }>(sql`
        SELECT id, vat_frequency, vat_anchor_end_month, financial_year_end_month
        FROM clients WHERE id = ${clientId} LIMIT 1
      `);
      return row ? clientCycleFrom(row) : undefined;
    },
  };
}
