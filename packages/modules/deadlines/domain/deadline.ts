import type { BusinessCalendar } from './business-calendar.js';

export type DeadlineKind = 'vat_return' | 'ct_return' | 'document_expiry' | 'custom';

/**
 * The statutory day a VAT return is due: the 28th of the month after the
 * period ends (FR-40).
 *
 * Returned before any weekend or holiday shift, because the shift is the
 * calendar's business and the statutory date is worth keeping separately. A
 * client asking "when was it actually due?" wants the shifted date; an
 * argument with the authority wants the statutory one.
 */
export function statutoryVatReturnDate(periodEnd: Date): Date {
  return new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, 28));
}

/**
 * The corporation tax return is due nine months after the financial year ends.
 *
 * Adding nine months to the 31st of a month can land on a day that does not
 * exist, so the result is clamped to the last day of the target month rather
 * than rolling into the next one. A deadline that silently moves a month later
 * is the worst possible rounding error here.
 */
export function statutoryCorporateTaxDate(yearEnd: Date): Date {
  const year = yearEnd.getUTCFullYear();
  const month = yearEnd.getUTCMonth() + 9;
  const day = yearEnd.getUTCDate();

  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTarget)));
}

export interface ComputedDeadline {
  /** The date the law names. */
  readonly statutory: Date;
  /** The date it can actually be filed by, once the calendar is applied. */
  readonly effective: Date;
  readonly movedBecause: 'weekend' | 'holiday' | null;
}

/**
 * Applies the calendar to a statutory date.
 *
 * Whether it moved, and why, is part of the answer. "Due on the 30th because
 * the 28th was Eid" is a sentence a client understands; a date on its own
 * invites the question.
 */
export function applyCalendar(statutory: Date, calendar: BusinessCalendar): ComputedDeadline {
  if (calendar.isBusinessDay(statutory)) {
    return { statutory, effective: statutory, movedBecause: null };
  }

  const reason = calendar.holidayOn(statutory) !== null ? 'holiday' : 'weekend';
  return {
    statutory,
    effective: calendar.nextBusinessDay(statutory),
    movedBecause: reason,
  };
}

/**
 * The escalation ladder (FR-43).
 *
 * Two of these count forward from when the document was asked for, and one
 * counts backwards from the deadline. That difference matters: chasing a
 * client is about how long they have been silent, while warning the manager is
 * about how little time is left.
 */
export interface EscalationPolicy {
  readonly remindClientAfterDays: number;
  readonly alertAccountantAfterDays: number;
  readonly alertManagerDaysBefore: number;
}

export const DEFAULT_ESCALATION: EscalationPolicy = {
  remindClientAfterDays: 7,
  alertAccountantAfterDays: 14,
  alertManagerDaysBefore: 5,
};

export type EscalationStage = 'client_reminder' | 'accountant_alert' | 'manager_alert';

export interface ScheduledEscalation {
  readonly stage: EscalationStage;
  readonly dueOn: Date;
}

/**
 * When each warning should fire for one piece of work.
 *
 * Computed as dates rather than checked repeatedly, so each one becomes a job
 * with a run-at time and nothing has to stay awake in between.
 */
export function escalationSchedule(params: {
  requestedOn: Date;
  deadline: Date | null;
  policy?: EscalationPolicy;
}): ScheduledEscalation[] {
  const policy = params.policy ?? DEFAULT_ESCALATION;
  const addDays = (from: Date, days: number) => new Date(from.getTime() + days * 86_400_000);

  const schedule: ScheduledEscalation[] = [
    {
      stage: 'client_reminder',
      dueOn: addDays(params.requestedOn, policy.remindClientAfterDays),
    },
    {
      stage: 'accountant_alert',
      dueOn: addDays(params.requestedOn, policy.alertAccountantAfterDays),
    },
  ];

  if (params.deadline) {
    const managerAlert = addDays(params.deadline, -policy.alertManagerDaysBefore);
    // A warning that would fire before the work was even requested tells
    // nobody anything, so it is left out rather than fired immediately.
    if (managerAlert.getTime() > params.requestedOn.getTime()) {
      schedule.push({ stage: 'manager_alert', dueOn: managerAlert });
    }
  }

  return schedule.sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime());
}
