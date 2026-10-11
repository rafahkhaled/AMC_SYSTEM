import type { BranchDirectory } from '@amc/billing';
import type { Database } from '@amc/database';
import { sql } from 'drizzle-orm';

/**
 * Which branches billing may put on a document.
 *
 * Billing is told two things and no more — is this one in use, and is any —
 * and does not read the branches table itself. Retired ones do not count: a
 * document cannot newly go out under a branch the firm has closed, though the
 * ones already issued under it keep printing as it.
 */
export function branchDirectory(db: Database): BranchDirectory {
  return {
    async isLive(code) {
      const rows = await db.execute<{ one: number }>(sql`
        SELECT 1 AS one FROM branches WHERE code = ${code} AND retired_at IS NULL
      `);
      return rows.length > 0;
    },
    async anyLive() {
      const rows = await db.execute<{ one: number }>(sql`
        SELECT 1 AS one FROM branches WHERE retired_at IS NULL LIMIT 1
      `);
      return rows.length > 0;
    },
  };
}
