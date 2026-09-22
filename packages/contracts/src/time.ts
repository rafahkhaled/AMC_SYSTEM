import { z } from 'zod';

export const runningTimerSchema = z.object({
  projectId: z.string(),
  assignmentId: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  service: z.string(),
  startedAt: z.string(),
  /** Seconds so far, from the server, so a stale tab cannot drift. Zero while held. */
  elapsedSeconds: z.number().int().nonnegative(),
  /** Held: the work is interrupted, the project is remembered, nothing is counting. */
  held: z.boolean(),
  /**
   * Everything recorded against this project today, held or running. It is what
   * somebody actually wants to know when they come back to a paused job.
   */
  todayOnProjectSeconds: z.number().int().nonnegative(),
});
export type RunningTimerView = z.infer<typeof runningTimerSchema>;

export const timeEntrySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  clientName: z.string(),
  service: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  seconds: z.number().int().nonnegative(),
  billable: z.boolean(),
  source: z.enum(['timer', 'manual']),
  locked: z.boolean(),
  /**
   * Why this entry is waiting to be confirmed, or null if nothing is in doubt
   * (FR-25). A flagged entry is real time — it counts on a timesheet — but it
   * cannot reach a client statement until the person who was there says so.
   */
  reviewReason: z.enum(['after_hours', 'abandoned', 'implausible']).nullable(),
});
export type TimeEntryView = z.infer<typeof timeEntrySchema>;

export const timerStateSchema = z.object({
  running: runningTimerSchema.nullable(),
  today: z.array(timeEntrySchema),
  todaySeconds: z.number().int().nonnegative(),
  todayBillableSeconds: z.number().int().nonnegative(),
});
export type TimerState = z.infer<typeof timerStateSchema>;

/**
 * When a timer action actually happened.
 *
 * Sent only when replaying what somebody did while their browser was offline
 * (NFR-03). The server clamps it to the window between the timer's start and
 * now, so a client can shorten a span but never invent one.
 */
const replayedAt = z.string().datetime().optional();

export const startTimerSchema = z.object({ projectId: z.string().min(1), at: replayedAt });
export const timerActionSchema = z.object({ at: replayedAt });

/** An instant the person typed, as the browser's datetime-local produces it. */
const localInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use a date and a time');

export const manualEntrySchema = z
  .object({
    projectId: z.string().min(1),
    startedAt: localInstant,
    endedAt: localInstant,
    /**
     * Why this was typed rather than timed (FR-22).
     *
     * Required by the domain and by a database constraint. Time entered by
     * hand is the part of a client statement most likely to be questioned,
     * and "I forgot to start the timer" is an answer; a blank field is not.
     */
    reason: z.string().trim().min(3, 'Say why this was entered by hand'),
    billable: z.boolean().default(true),
    note: z.string().trim().max(500).optional(),
  })
  .refine((entry) => entry.endedAt > entry.startedAt, {
    message: 'It has to end after it started',
    path: ['endedAt'],
  });
export type ManualEntryRequest = z.infer<typeof manualEntrySchema>;

export const timesheetDaySchema = z.object({
  day: z.string(),
  seconds: z.number().int().nonnegative(),
  billableSeconds: z.number().int().nonnegative(),
});

export const timesheetSchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.array(timesheetDaySchema),
  totalSeconds: z.number().int().nonnegative(),
  billableSeconds: z.number().int().nonnegative(),
  entries: z.array(timeEntrySchema),
});
export type Timesheet = z.infer<typeof timesheetSchema>;

export const awaitingReviewSchema = z.object({ entries: z.array(timeEntrySchema) });

/**
 * Recorded time waiting for a manager to approve it (FR-23).
 *
 * The queue that makes approval possible at all: approving by id needs
 * somewhere the ids can be seen, and a timesheet shows day totals.
 *
 * Only what has finished, is not approved, and is not already on a statement.
 * `reviewReason` comes along because an entry the person who worked it has
 * not yet confirmed is exactly the one a manager should look at hardest.
 */
export const pendingApprovalSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  clientName: z.string(),
  service: z.string(),
  projectId: z.string(),
  day: z.string(),
  seconds: z.number().int().nonnegative(),
  billable: z.boolean(),
  source: z.enum(['timer', 'manual']),
  /** Required on a manual entry, so a manager can see why it was typed in. */
  reason: z.string().nullable(),
  reviewReason: z.enum(['after_hours', 'abandoned', 'implausible']).nullable(),
  reviewedAt: z.string().nullable(),
});
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

export const pendingApprovalsSchema = z.object({ entries: z.array(pendingApprovalSchema) });
export type PendingApprovals = z.infer<typeof pendingApprovalsSchema>;

/**
 * Which recorded hours a manager is approving (FR-23).
 *
 * By id, not by date range: the audit row should name exactly what was
 * approved, and a range approves whatever happens to fall inside it —
 * including a row somebody added while the screen was open.
 */
export const approveEntriesSchema = z.object({
  entryIds: z.array(z.string().min(1)).min(1, { message: 'Nothing was selected to approve' }),
});
export type ApproveEntriesRequest = z.infer<typeof approveEntriesSchema>;
