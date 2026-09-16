import { z } from 'zod';

export const deadlineKindSchema = z.enum([
  'vat_return',
  'ct_return',
  'document_expiry',
  'task',
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
  /** Set for a task, so the entry can be opened. */
  taskId: z.string().nullable(),
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
