import type { Clock, IdGenerator } from '@amc/kernel';
import { sql } from 'drizzle-orm';
import { type Job, type JobRequest, backoffSeconds } from './job.js';

/**
 * Timestamps are sent as ISO text with an explicit cast. The raw SQL template
 * hands parameters straight to the driver, which does not know a Date is meant
 * to be a timestamp, and a silent type mismatch here would be a bad way to
 * discover that a job never ran.
 */
const at = (value: Date) => value.toISOString();

/**
 * Anything that can run SQL: the pool, or one transaction from it.
 *
 * Deliberately loose. The point of the interface is that a caller can pass its
 * own transaction handle so a job joins that transaction, and pinning the
 * driver's exact generic here would defeat that for no benefit. Rows are
 * narrowed at each call site, where the shape is actually known.
 */
export interface SqlRunner {
  // biome-ignore lint/suspicious/noExplicitAny: the driver's row type is narrowed per query below
  execute(query: ReturnType<typeof sql>): Promise<any>;
}

async function rowsOf<T>(runner: SqlRunner, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await runner.execute(query)) as T[];
}

export interface ClaimOptions {
  readonly worker: string;
  readonly limit: number;
  /** How long a claim is held before another worker may take the job back. */
  readonly leaseSeconds: number;
}

interface JobRow {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  run_at: Date;
}

/**
 * The queue, on Postgres (ADR-0006).
 *
 * Enqueueing takes whichever handle the caller is already using, so a job can
 * be added inside the transaction that caused it. That is the property this
 * design exists for: a change either commits with its job, or neither happens.
 */
export class PostgresJobQueue {
  constructor(
    private readonly db: SqlRunner,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /**
   * Add work. Pass a transaction handle to make it part of that transaction.
   * Returns the id, or null when a live job already holds the same unique key.
   */
  async enqueue(request: JobRequest, runner: SqlRunner = this.db): Promise<string | null> {
    const id = this.ids.next();
    const rows = await rowsOf<{ id: string }>(
      runner,
      sql`
      INSERT INTO jobs (id, name, payload, run_at, priority, max_attempts, unique_key)
      VALUES (
        ${id},
        ${request.name},
        ${JSON.stringify(request.payload ?? {})}::jsonb,
        ${at(request.runAt ?? this.clock.now())}::timestamptz,
        ${request.priority ?? 0},
        ${request.maxAttempts ?? 5},
        ${request.uniqueKey ?? null}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Take up to `limit` runnable jobs.
   *
   * SKIP LOCKED is what makes this safe with more than one worker: a row
   * another worker is claiming is stepped over rather than waited for, so two
   * workers never receive the same job and neither blocks the other.
   */
  async claim(options: ClaimOptions): Promise<Job[]> {
    const now = this.clock.now();
    const leaseUntil = new Date(now.getTime() + options.leaseSeconds * 1000);

    const rows = await rowsOf<JobRow>(
      this.db,
      sql`
      WITH claimed AS (
        SELECT id FROM jobs
        WHERE completed_at IS NULL
          AND failed_at IS NULL
          AND run_at <= ${at(now)}::timestamptz
          AND (claimed_at IS NULL OR lease_until < ${at(now)}::timestamptz)
        ORDER BY priority DESC, run_at
        LIMIT ${options.limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs
      SET claimed_at = ${at(now)}::timestamptz,
          claimed_by = ${options.worker},
          lease_until = ${at(leaseUntil)}::timestamptz,
          attempts = jobs.attempts + 1
      FROM claimed
      WHERE jobs.id = claimed.id
      RETURNING jobs.id, jobs.name, jobs.payload, jobs.attempts, jobs.max_attempts, jobs.run_at
    `,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      runAt: row.run_at,
    }));
  }

  async complete(jobId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE jobs
      SET completed_at = ${at(this.clock.now())}::timestamptz, claimed_at = NULL, claimed_by = NULL, lease_until = NULL
      WHERE id = ${jobId}
    `);
  }

  /**
   * Record a failure and decide what happens next: another attempt after a
   * backoff, or a stop. A job that has run out of attempts is kept and marked
   * failed rather than deleted, because "what happened to that batch?" must
   * always have an answer.
   */
  async fail(job: Job, error: string, permanent = false): Promise<'retrying' | 'failed'> {
    const exhausted = permanent || job.attempts >= job.maxAttempts;
    const now = this.clock.now();

    if (exhausted) {
      await this.db.execute(sql`
        UPDATE jobs
        SET failed_at = ${at(now)}::timestamptz, last_error = ${error.slice(0, 2000)},
            claimed_at = NULL, claimed_by = NULL, lease_until = NULL
        WHERE id = ${job.id}
      `);
      return 'failed';
    }

    const retryAt = new Date(now.getTime() + backoffSeconds(job.attempts) * 1000);
    await this.db.execute(sql`
      UPDATE jobs
      SET run_at = ${at(retryAt)}::timestamptz, last_error = ${error.slice(0, 2000)},
          claimed_at = NULL, claimed_by = NULL, lease_until = NULL
      WHERE id = ${job.id}
    `);
    return 'retrying';
  }

  /**
   * Hand back the work of a worker that died. The lease has already lapsed by
   * definition, so this only tidies the claim columns; the job was runnable
   * again the moment it expired.
   */
  async releaseExpiredClaims(): Promise<number> {
    const rows = await rowsOf<{ id: string }>(
      this.db,
      sql`
      UPDATE jobs
      SET claimed_at = NULL, claimed_by = NULL, lease_until = NULL
      WHERE completed_at IS NULL AND failed_at IS NULL
        AND claimed_at IS NOT NULL AND lease_until < ${at(this.clock.now())}::timestamptz
      RETURNING id
    `,
    );
    return rows.length;
  }

  /** What an operator wants to see first thing in the morning. */
  async counts(): Promise<{ pending: number; running: number; failed: number }> {
    const now = this.clock.now();
    const rows = await rowsOf<{ pending: string; running: string; failed: string }>(
      this.db,
      sql`
      SELECT
        count(*) FILTER (
          WHERE completed_at IS NULL AND failed_at IS NULL
            AND (claimed_at IS NULL OR lease_until < ${at(now)}::timestamptz)
        )::text AS pending,
        count(*) FILTER (
          WHERE completed_at IS NULL AND failed_at IS NULL
            AND claimed_at IS NOT NULL AND lease_until >= ${at(now)}::timestamptz
        )::text AS running,
        count(*) FILTER (WHERE failed_at IS NOT NULL)::text AS failed
      FROM jobs
    `,
    );
    return {
      pending: Number(rows[0]?.pending ?? 0),
      running: Number(rows[0]?.running ?? 0),
      failed: Number(rows[0]?.failed ?? 0),
    };
  }
}
