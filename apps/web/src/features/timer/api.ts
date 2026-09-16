import {
  type ManualEntryRequest,
  type TimerState,
  type Timesheet,
  timerStateSchema,
  timesheetSchema,
} from '@amc/contracts';
import { request, send } from '../auth/api.js';

export async function timerState(): Promise<TimerState> {
  return timerStateSchema.parse(await request('/timer'));
}

export async function startTimer(taskId: string): Promise<TimerState> {
  return timerStateSchema.parse(await send('/timer/start', { taskId }));
}

export async function stopTimer(): Promise<TimerState> {
  return timerStateSchema.parse(await send('/timer/stop'));
}

/** Hold: the work is interrupted. The span so far is recorded either way. */
export async function holdTimer(): Promise<TimerState> {
  return timerStateSchema.parse(await send('/timer/hold'));
}

export async function resumeTimer(): Promise<TimerState> {
  return timerStateSchema.parse(await send('/timer/resume'));
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
