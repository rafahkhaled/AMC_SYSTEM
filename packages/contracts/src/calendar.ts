import { z } from 'zod';

export const deadlineKindSchema = z.enum([
  'vat_return',
  'ct_return',
  'document_expiry',
  'project',
  'custom',
]);
export type DeadlineKind = z.infer<typeof deadlineKindSchema>;

export const calendarEntrySchema = z.object({
  id: z.string(),
  kind: deadlineKindSchema,
  clientId: z.string(),
  clientName: z.string(),
  /** The service or document type, for the screen to translate. */
  subject: z.string(),
  periodKey: z.string().nullable(),
  /** The day it is actually due, after weekends and holidays are applied. */
  dueOn: z.string(),
  /** The day the law names, when the calendar moved it. Null when it did not. */
  statutoryOn: z.string().nullable(),
  movedBecause: z.enum(['weekend', 'holiday']).nullable(),
  isOverdue: z.boolean(),
  isDone: z.boolean(),
  /** Set for a project, so the entry can be opened. */
  projectId: z.string().nullable(),
});
export type CalendarEntry = z.infer<typeof calendarEntrySchema>;

export const calendarMonthSchema = z.object({
  /** The month this covers, as 2026-10. */
  month: z.string(),
  /**
   * Every day of the month, in order, including the ones with nothing on
   * them. A grid needs the empty days as much as the full ones, and deciding
   * which weekday a month starts on is a calculation worth doing once.
   */
  days: z.array(
    z.object({
      date: z.string(),
      isWeekend: z.boolean(),
      /* Both names, because the screen picks by language and the server should
         not have to be told which one the reader uses. */
      holiday: z.object({ nameEn: z.string(), nameAr: z.string() }).nullable(),
      entries: z.array(calendarEntrySchema),
    }),
  ),
  /** What is already late, whatever month it was due in. */
  overdue: z.array(calendarEntrySchema),
});
export type CalendarMonth = z.infer<typeof calendarMonthSchema>;

/**
 * What is due soon and what is already late (FR-80).
 *
 * A flat list rather than a grid. The month view answers "what does October
 * look like"; this answers "what do I have to do about it", and the two are
 * different questions — the second one crosses the month boundary, which is
 * exactly the join a grid hides.
 */
export const upcomingDeadlinesSchema = z.object({
  /** How many days ahead this looked. */
  within: z.number().int().positive(),
  overdue: z.array(calendarEntrySchema),
  /** Soonest first, with anything done or already late left out. */
  soon: z.array(calendarEntrySchema),
});
export type UpcomingDeadlines = z.infer<typeof upcomingDeadlinesSchema>;
