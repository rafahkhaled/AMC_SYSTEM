import type { Database } from '@amc/database';
import type { Clock } from '@amc/kernel';
import type { PostgresJobQueue } from '@amc/queue';
import { RecurringWork } from '@amc/services';
import { ALL_SERVICES } from '@amc/services/domain';
import {
  DrizzleClientServiceRepository,
  DrizzleTaskRepository,
} from '@amc/services/infrastructure';
import { AlertLog } from './alerts.js';
import { loadClientCycles } from './client-cycles.js';
import { sweepDocumentExpiry } from './document-expiry.js';
import { scheduleEscalations } from './escalations.js';

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
  readonly tasksCreated: number;
  readonly escalationsScheduled: number;
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

  /*
   * Create the work that has come round again (FR-14, FR-41).
   *
   * Running this daily rather than monthly is what delivers the day-one
   * trigger: the task appears on the first morning after a period closes,
   * which is the whole point of not waiting for the deadline.
   */
  const cycles = await loadClientCycles(params.db);
  const recurring = new RecurringWork(
    new DrizzleClientServiceRepository(params.db),
    new DrizzleTaskRepository(params.db),
    params.clock,
    params.ids,
  );

  let tasksCreated = 0;
  for (const template of ALL_SERVICES) {
    for (const created of await recurring.sweep(template.code, cycles)) {
      tasksCreated += 1;
      params.log?.('work created', {
        service: created.service,
        clientId: created.clientId,
        period: created.periodKey,
        dueAt: created.dueAt?.toISOString().slice(0, 10) ?? null,
      });
    }
  }

  // Chase what is stuck, now that today's work exists to be chased.
  const escalationsScheduled = await scheduleEscalations({
    db: params.db,
    queue: params.queue,
    now: today,
  });

  await scheduleNextDailySweep(params.queue, today);
  return { expiryWarnings: warnings.length, tasksCreated, escalationsScheduled };
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
