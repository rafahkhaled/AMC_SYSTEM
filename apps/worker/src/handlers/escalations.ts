import type { Database } from '@amc/database';
import {
  DEFAULT_ESCALATION,
  type EscalationStage,
  escalationSchedule,
} from '@amc/deadlines/domain';
import type { PostgresJobQueue } from '@amc/queue';
import { sql } from 'drizzle-orm';
import type { AlertLog } from './alerts.js';
import type { EscalationNotifier } from './notify-escalation.js';

export const ESCALATION_JOB = 'deadlines.escalate';

export interface EscalationPayload extends Record<string, unknown> {
  readonly projectId: string;
  readonly clientId: string;
  readonly stage: EscalationStage;
}

/**
 * Puts the escalation ladder on the queue (FR-43).
 *
 * Each rung becomes a job with a run-at time rather than something checked
 * every morning, so nothing has to stay awake between them and a reminder due
 * in six weeks costs nothing until then. The unique key means scheduling the
 * same rung twice is a no-op, which is what lets this run on every sweep.
 */
export async function scheduleEscalations(params: {
  db: Database;
  queue: PostgresJobQueue;
  now: Date;
}): Promise<number> {
  // Work that is stuck waiting for paperwork, which is what the ladder chases.
  // Raw SQL hands timestamps back as strings on this path, unlike the query
  // builder, so they are typed as such and converted once here rather than
  // being trusted to already be dates.
  const waiting = await params.db.execute<{
    id: string;
    client_id: string;
    created_at: string | Date;
    due_at: string | Date | null;
  }>(sql`
    SELECT id, client_id, created_at, due_at
    FROM projects
    WHERE state IN ('awaiting_documents', 'waiting_for_client')
  `);

  let scheduled = 0;

  for (const project of waiting) {
    const ladder = escalationSchedule({
      requestedOn: new Date(project.created_at),
      deadline: project.due_at ? new Date(project.due_at) : null,
      policy: DEFAULT_ESCALATION,
    });

    for (const rung of ladder) {
      // A rung whose moment has passed is not fired late. Sending a
      // seven-day reminder on day forty would be worse than silence.
      if (rung.dueOn.getTime() < params.now.getTime()) continue;

      const queued = await params.queue.enqueue({
        name: ESCALATION_JOB,
        runAt: rung.dueOn,
        uniqueKey: `${ESCALATION_JOB}:${project.id}:${rung.stage}`,
        payload: {
          projectId: project.id,
          clientId: project.client_id,
          stage: rung.stage,
        } satisfies EscalationPayload,
      });
      if (queued) scheduled += 1;
    }
  }

  return scheduled;
}

/**
 * Fires one rung.
 *
 * It re-reads the project first, because the job was queued days or weeks ago and
 * the documents may well have arrived since. Chasing a client for paperwork
 * they already sent is the fastest way to teach them to ignore the reminders.
 */
export async function fireEscalation(params: {
  db: Database;
  alerts: AlertLog;
  notifier?: EscalationNotifier | undefined;
  payload: EscalationPayload;
}): Promise<'raised' | 'no_longer_needed' | 'already_raised'> {
  const [project] = await params.db.execute<{ state: string }>(sql`
    SELECT state FROM projects WHERE id = ${params.payload.projectId}
  `);

  if (!project || !['awaiting_documents', 'waiting_for_client'].includes(project.state)) {
    return 'no_longer_needed';
  }

  const raised = await params.alerts.raise({
    subjectType: 'project',
    subjectId: params.payload.projectId,
    stage: params.payload.stage,
    clientId: params.payload.clientId,
    detail: { state: project.state },
  });

  /*
   * Raising the alert records that a rung was reached; telling somebody is a
   * separate thing, and only happens the first time. The alert log is what
   * stops a person being chased twice for the same rung, so the notification
   * hangs off its answer rather than repeating the check.
   */
  if (raised && params.notifier) {
    await params.notifier.tell({
      projectId: params.payload.projectId,
      clientId: params.payload.clientId,
      stage: params.payload.stage,
    });
  }

  return raised ? 'raised' : 'already_raised';
}
