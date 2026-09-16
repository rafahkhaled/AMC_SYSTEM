import type { Database } from '@amc/database';
import type { Clock } from '@amc/kernel';
import type { PostgresJobQueue } from '@amc/queue';
import { AlertLog } from './alerts.js';
import { sweepDocumentExpiry } from './document-expiry.js';

export const DAILY_SWEEP = 'schedule.daily';

/** When the sweep should run, in Dubai: early, before anyone is working. */
const RUN_AT_HOUR_DUBAI = 6;
const DUBAI_OFFSET_HOURS = 4;

/**
 * The next time the daily sweep should run.
 *
 * Computed rather than stored as a cron expression, because the only schedule
 * this system needs is "once a day, early" and a cron parser is a dependency
 * and a syntax for one line of arithmetic.
 */
export function nextDailyRun(after: Date): Date {
  const runAtUtcHour = RUN_AT_HOUR_DUBAI - DUBAI_OFFSET_HOURS;
  const candidate = new Date(
    Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), runAtUtcHour),
  );
  if (candidate.getTime() <= after.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

export interface DailySweepResult {
  readonly expiryWarnings: number;
}

/**
 * Everything that happens once a day.
 *
 * It re-enqueues itself at the end rather than relying on anything outside the
 * database to wake it. That keeps the schedule in the same place as the work,
 * and means a restarted worker picks up where it left off instead of waiting
 * for an external timer nobody remembered to configure.
 *
 * The unique key is the date, so two workers running the sweep on the same
 * morning enqueue one job between them.
 */
export async function runDailySweep(params: {
  db: Database;
  queue: PostgresJobQueue;
  clock: Clock;
  ids: { next(): string };
  log?: (message: string, detail: Record<string, unknown>) => void;
}): Promise<DailySweepResult> {
  const today = params.clock.now();
  const alerts = new AlertLog(params.db, params.ids);

  const warnings = await sweepDocumentExpiry({ db: params.db, alerts, today });
  for (const warning of warnings) {
    params.log?.('document expiring', {
      client: warning.clientName,
      type: warning.type,
      days: warning.daysRemaining,
      expiresOn: warning.expiresOn,
    });
  }

  await scheduleNextDailySweep(params.queue, today);
  return { expiryWarnings: warnings.length };
}

export async function scheduleNextDailySweep(queue: PostgresJobQueue, after: Date): Promise<void> {
  const runAt = nextDailyRun(after);
  await queue.enqueue({
    name: DAILY_SWEEP,
    runAt,
    // One sweep per day however many workers try to schedule it.
    uniqueKey: `${DAILY_SWEEP}:${runAt.toISOString().slice(0, 10)}`,
    priority: 5,
  });
}
