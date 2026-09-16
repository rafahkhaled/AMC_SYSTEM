import { type TimerState, timerStateSchema } from '@amc/contracts';
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

/** Tells the server the timer is still on screen. */
export async function beat(): Promise<void> {
  await send('/timer/beat').catch(() => {
    // A missed heartbeat is not worth interrupting anyone over. The next one
    // will land, and the server trims an abandoned timer to the last it saw.
  });
}
