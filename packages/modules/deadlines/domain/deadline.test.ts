import { describe, expect, it } from 'vitest';
import { BusinessCalendar, type Holiday } from './business-calendar.js';
import {
  DEFAULT_ESCALATION,
  applyCalendar,
  escalationSchedule,
  statutoryCorporateTaxDate,
  statutoryVatReturnDate,
} from './deadline.js';

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = (date: Date) => date.toISOString().slice(0, 10);

describe('the VAT return date (FR-40)', () => {
  it('is the 28th of the month after the period ends', () => {
    expect(day(statutoryVatReturnDate(at('2026-06-30')))).toBe('2026-07-28');
  });

  it('follows a staggered period just the same', () => {
    // A client whose quarter ends in July files by 28 August.
    expect(day(statutoryVatReturnDate(at('2026-07-31')))).toBe('2026-08-28');
  });

  it('crosses the turn of the year', () => {
    expect(day(statutoryVatReturnDate(at('2026-12-31')))).toBe('2027-01-28');
  });
});

describe('the corporation tax return date', () => {
  it('is nine months after the financial year ends', () => {
    expect(day(statutoryCorporateTaxDate(at('2026-12-31')))).toBe('2027-09-30');
  });

  it('does not roll into the next month when the day does not exist', () => {
    // Nine months after 31 May is 28 or 29 February, not 2 or 3 March. A
    // deadline that silently moves a month later is the worst rounding error
    // available here.
    expect(day(statutoryCorporateTaxDate(at('2027-05-31')))).toBe('2028-02-29');
    expect(day(statutoryCorporateTaxDate(at('2026-05-31')))).toBe('2027-02-28');
  });

  it('handles a June year end', () => {
    expect(day(statutoryCorporateTaxDate(at('2026-06-30')))).toBe('2027-03-30');
  });
});

describe('applying the calendar', () => {
  const calendar = new BusinessCalendar([
    // A Saturday, and a Wednesday. The mid-week one matters: a holiday that
    // falls on a weekend would move anyway, so it cannot on its own show that
    // the holiday rule works.
    { date: '2026-11-28', nameEn: 'Eid', nameAr: 'عيد' } satisfies Holiday,
    { date: '2026-12-02', nameEn: 'National Day', nameAr: 'اليوم الوطني' } satisfies Holiday,
  ]);

  it('leaves a date on a working day untouched', () => {
    const computed = applyCalendar(at('2026-07-28'), calendar);
    expect(day(computed.effective)).toBe('2026-07-28');
    expect(computed.movedBecause).toBeNull();
  });

  it('moves a weekend deadline to the next open day, and says so', () => {
    // 28 February 2026 is a Saturday.
    const computed = applyCalendar(at('2026-02-28'), calendar);
    expect(day(computed.effective)).toBe('2026-03-02');
    expect(computed.movedBecause).toBe('weekend');
  });

  it('moves a holiday that falls mid-week, where no weekend could explain it', () => {
    // 2 December 2026 is a Wednesday, so only the holiday rule can move this.
    const computed = applyCalendar(at('2026-12-02'), calendar);
    expect(computed.movedBecause).toBe('holiday');
    expect(day(computed.effective)).toBe('2026-12-03');
  });

  it('blames the holiday rather than the weekend when a date is both', () => {
    const computed = applyCalendar(at('2026-11-28'), calendar);
    // "Due on the 30th because the 28th was Eid" is a sentence a client
    // understands; "because it was a Saturday" is the lesser reason when both
    // are true.
    expect(computed.movedBecause).toBe('holiday');
    expect(day(computed.effective)).toBe('2026-11-30');
  });

  it('keeps the statutory date alongside the effective one', () => {
    const computed = applyCalendar(at('2026-02-28'), calendar);
    // An argument with the authority is about the statutory date; a
    // conversation with the client is about the effective one.
    expect(day(computed.statutory)).toBe('2026-02-28');
  });
});

describe('the escalation ladder (FR-43)', () => {
  const requestedOn = at('2026-09-01');

  it('chases the client at seven days and the accountant at fourteen', () => {
    const schedule = escalationSchedule({ requestedOn, deadline: at('2026-10-28') });
    expect(schedule.map((entry) => [entry.stage, day(entry.dueOn)])).toEqual([
      ['client_reminder', '2026-09-08'],
      ['accountant_alert', '2026-09-15'],
      ['manager_alert', '2026-10-23'],
    ]);
  });

  it('warns the manager five days before the deadline, counting backwards', () => {
    // The two client-facing stages count forward from the request; this one
    // counts back from the deadline. Silence and time remaining are different
    // questions.
    const [manager] = escalationSchedule({
      requestedOn,
      deadline: at('2026-09-30'),
    }).filter((entry) => entry.stage === 'manager_alert');
    expect(day(manager?.dueOn ?? new Date(0))).toBe('2026-09-25');
  });

  it('leaves out a manager warning that would fire before the work was asked for', () => {
    // Firing it immediately would tell nobody anything.
    const schedule = escalationSchedule({ requestedOn, deadline: at('2026-09-03') });
    expect(schedule.map((entry) => entry.stage)).toEqual(['client_reminder', 'accountant_alert']);
  });

  it('still chases when there is no deadline at all', () => {
    const schedule = escalationSchedule({ requestedOn, deadline: null });
    expect(schedule).toHaveLength(2);
  });

  it('honours a policy the firm has changed', () => {
    const schedule = escalationSchedule({
      requestedOn,
      deadline: at('2026-10-28'),
      policy: { ...DEFAULT_ESCALATION, remindClientAfterDays: 3 },
    });
    expect(day(schedule[0]?.dueOn ?? new Date(0))).toBe('2026-09-04');
  });

  it('returns them in the order they will happen', () => {
    const schedule = escalationSchedule({ requestedOn, deadline: at('2026-09-20') });
    const times = schedule.map((entry) => entry.dueOn.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
