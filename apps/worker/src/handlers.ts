import type { Database } from '@amc/database';
import type { Clock } from '@amc/kernel';
import type { JobRunner, PostgresJobQueue } from '@amc/queue';
import { AlertLog } from './handlers/alerts.js';
import { DAILY_SWEEP, runDailySweep, scheduleNextDailySweep } from './handlers/daily.js';
import { ESCALATION_JOB, type EscalationPayload, fireEscalation } from './handlers/escalations.js';
import type { EscalationNotifier } from './handlers/notify-escalation.js';
import {
  QUOTATION_EMAIL_JOB,
  type QuotationEmailPayload,
  sendQuotationEmail,
} from './handlers/quotation-email.js';
import type { OutboxPublisher } from './outbox-publisher.js';

/**
 * Where each phase plugs its background work in.
 *
 * The one rule for anything registered here: a handler must tolerate seeing
 * the same work twice. Delivery is at-least-once, and a job that is not safe
 * to repeat will eventually be repeated.
 */
export function registerJobHandlers(
  runner: JobRunner,
  context: {
    db: Database;
    queue: PostgresJobQueue;
    clock: Clock;
    ids: { next(): string };
    /**
     * Who to tell when a rung fires (FR-43). Optional so the worker still
     * runs without it — an escalation that is recorded but not delivered is
     * a smaller failure than a worker that will not start.
     */
    notifier?: EscalationNotifier | undefined;
    /**
     * How a quotation reaches the client. Optional for the same reason the
     * notifier is: a worker that will not start is the worse failure.
     */
    email?: import('@amc/notifications').EmailSender | undefined;
    log: (message: string, detail: Record<string, unknown>) => void;
  },
): JobRunner {
  return runner
    .register(DAILY_SWEEP, async () => {
      const result = await runDailySweep(context);
      context.log('daily sweep finished', {
        expiryWarnings: result.expiryWarnings,
        projectsCreated: result.projectsCreated,
        escalationsScheduled: result.escalationsScheduled,
      });
    })
    .register<EscalationPayload>(ESCALATION_JOB, async (job) => {
      const outcome = await fireEscalation({
        db: context.db,
        alerts: new AlertLog(context.db, context.ids),
        notifier: context.notifier,
        payload: job.payload,
      });
      context.log('escalation', {
        project: job.payload.projectId,
        stage: job.payload.stage,
        outcome,
      });
    })
    .register<QuotationEmailPayload>(QUOTATION_EMAIL_JOB, async (job) => {
      if (!context.email) {
        // Nothing to send with. Thrown rather than swallowed so the job
        // retries once a sender exists, instead of being marked done while
        // the client waits for a quotation nobody posted.
        throw new Error('no email sender is configured for quotation delivery');
      }
      await sendQuotationEmail(context.email, job.payload);
      context.log('quotation emailed', {
        quotation: job.payload.quotationId,
        reference: job.payload.reference,
      });
    });
}

export function registerEventSubscribers(publisher: OutboxPublisher): OutboxPublisher {
  return publisher;
}

export { scheduleNextDailySweep };
