import type { Database } from '@amc/database';
import { sql } from 'drizzle-orm';

export interface Alert {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly stage: string;
  readonly clientId?: string | null;
  readonly detail?: Record<string, unknown>;
}

/**
 * Records that something has been raised, and says whether it was new.
 *
 * The uniqueness lives in the database, so the sweep does not have to remember
 * what it did yesterday. It can run twice in a morning or catch up after a
 * week of downtime, and nobody receives the same warning twice.
 */
export class AlertLog {
  constructor(
    private readonly db: Database,
    private readonly ids: { next(): string },
  ) {}

  /** True when this is the first time; false when it has been raised before. */
  async raise(alert: Alert): Promise<boolean> {
    const rows = await this.db.execute<{ id: string }>(sql`
      INSERT INTO raised_alerts (id, subject_type, subject_id, stage, client_id, detail)
      VALUES (
        ${this.ids.next()},
        ${alert.subjectType},
        ${alert.subjectId},
        ${alert.stage},
        ${alert.clientId ?? null},
        ${JSON.stringify(alert.detail ?? {})}::jsonb
      )
      ON CONFLICT (subject_type, subject_id, stage) DO NOTHING
      RETURNING id
    `);
    return rows.length > 0;
  }
}
