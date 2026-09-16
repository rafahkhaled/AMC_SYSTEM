import {
  type ManualEntryRequest,
  type TimerState,
  type Timesheet,
  timerStateSchema,
  timesheetSchema,
} from '@amc/contracts';
import { ApiError, request, send } from '../auth/api.js';
import { type TimerAction, available, enqueue, forget, pending } from './offline-queue.js';

export async function timerState(): Promise<TimerState> {
  return timerStateSchema.parse(await request('/timer'));
}

export async function startTimer(taskId: string): Promise<TimerState> {
  return act('start', taskId);
}

export async function stopTimer(): Promise<TimerState> {
  return act('stop', null);
}

/** Hold: the work is interrupted. The span so far is recorded either way. */
export async function holdTimer(): Promise<TimerState> {
  return act('hold', null);
}

export async function resumeTimer(): Promise<TimerState> {
  return act('resume', null);
}

/**
 * Writes the action down, then sends it.
 *
 * That order is the whole point. A person taps stop, the train enters a
 * tunnel, and the request fails — the record of what they did is already on
 * the device, and the hour is not lost. Doing it the other way round would
 * mean the only copy of the intent lived in a request that never arrived.
 */
async function act(action: TimerAction, taskId: string | null): Promise<TimerState> {
  const at = new Date();

  if (!available()) {
    // No queue to write to, so there is nothing to lose by sending directly
    // and nothing to promise if it fails.
    return timerStateSchema.parse(await sendAction(action, taskId, at.toISOString()));
  }

  await enqueue(action, taskId, at);

  /*
   * Everything goes out through the queue, including what was just added, so
   * there is one path and one order. Sending directly and draining separately
   * would send this action twice whenever the queue was not already empty.
   */
  const drained = await replayPending();
  if (drained.remaining > 0 || !drained.state) throw new PendingSync(drained.remaining);
  return timerStateSchema.parse(drained.state);
}

function sendAction(action: TimerAction, taskId: string | null, at: string): Promise<unknown> {
  return send(`/timer/${action}`, { at, ...(taskId ? { taskId } : {}) });
}

/**
 * The action is safe on this device but the server has not heard it yet.
 *
 * A distinct failure, because the screen must not say "that did not work"
 * about an hour it has in fact written down. What it should say is that the
 * hour is kept and will be sent.
 */
export class PendingSync extends Error {
  constructor(readonly waiting: number) {
    super('Kept on this device until the connection comes back');
    this.name = 'PendingSync';
  }
}

/**
 * Sends everything the queue is still holding, oldest first.
 *
 * Order matters: a start after a stop is a different piece of work, and
 * replaying them the other way round books the gap to the wrong client. One
 * failure stops the run rather than skipping ahead, for the same reason.
 */
export async function replayPending(): Promise<{
  sent: number;
  remaining: number;
  state: unknown;
}> {
  if (!available()) return { sent: 0, remaining: 0, state: null };

  const queue = await pending();
  let sent = 0;
  let state: unknown = null;

  for (const [index, queued] of queue.entries()) {
    try {
      state = await sendAction(queued.action, queued.taskId, queued.at);
      await forget(queued.id);
      sent += 1;
    } catch (failure) {
      /*
       * A refusal is not a connection problem. "No such task" will be refused
       * again every time, and a queue that retries it forever never drains —
       * so a refused action is dropped and the rest go on. Anything else
       * stays queued, which is the case this whole mechanism exists for.
       */
      if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) {
        await forget(queued.id);
        continue;
      }
      return { sent, remaining: queue.length - index, state };
    }
  }
  return { sent, remaining: 0, state };
}

/** How many actions are waiting, for the screen to say so. */
export async function pendingCount(): Promise<number> {
  return available() ? (await pending()).length : 0;
}

/** Tells the server the timer is still on screen. */
export async function beat(): Promise<void> {
  await send('/timer/beat').catch(() => {
    // A missed heartbeat is not worth interrupting anyone over. The next one
    // will land, and the server trims an abandoned timer to the last it saw.
  });
}

/** Record work that was done but not timed (FR-22). */
export async function recordManual(entry: ManualEntryRequest): Promise<TimerState> {
  return timerStateSchema.parse(await send('/timer/entries', entry));
}

export async function timesheet(from: string, to: string): Promise<Timesheet> {
  return timesheetSchema.parse(
    await request(`/timer/timesheet?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  );
}
