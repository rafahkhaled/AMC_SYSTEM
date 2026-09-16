import { z } from 'zod';

export const runningTimerSchema = z.object({
  taskId: z.string(),
  assignmentId: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  service: z.string(),
  startedAt: z.string(),
  /** Seconds so far, from the server, so a stale tab cannot drift. Zero while held. */
  elapsedSeconds: z.number().int().nonnegative(),
  /** Held: the work is interrupted, the task is remembered, nothing is counting. */
  held: z.boolean(),
  /**
   * Everything recorded against this task today, held or running. It is what
   * somebody actually wants to know when they come back to a paused job.
   */
  todayOnTaskSeconds: z.number().int().nonnegative(),
});
export type RunningTimerView = z.infer<typeof runningTimerSchema>;

export const timeEntrySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  clientName: z.string(),
  service: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  seconds: z.number().int().nonnegative(),
  billable: z.boolean(),
  source: z.enum(['timer', 'manual']),
  locked: z.boolean(),
});
export type TimeEntryView = z.infer<typeof timeEntrySchema>;

export const timerStateSchema = z.object({
  running: runningTimerSchema.nullable(),
  today: z.array(timeEntrySchema),
  todaySeconds: z.number().int().nonnegative(),
  todayBillableSeconds: z.number().int().nonnegative(),
});
export type TimerState = z.infer<typeof timerStateSchema>;

export const startTimerSchema = z.object({ taskId: z.string().min(1) });
