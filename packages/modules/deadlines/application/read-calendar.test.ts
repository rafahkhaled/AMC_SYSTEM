import { describe, expect, it } from 'vitest';
import type { CalendarScope, DueThing, HolidaySource } from './ports.js';
import { ReadCalendar } from './read-calendar.js';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-16T06:00:00Z');

const MANAGER = { userId: 'user-a', permissions: new Set(['clients.view.all']) };

function calendar(
  things: DueThing[],
  holidays: { date: string; nameEn: string; nameAr: string }[] = [],
) {
  const source = {
    between: async (scope: CalendarScope) =>
      scope.kind === 'none' ? [] : things.filter((thing) => !thing.isDone || true),
    overdue: async (scope: CalendarScope) =>
      scope.kind === 'none' ? [] : things.filter((thing) => !thing.isDone && thing.dueOn < NOW),
  };
  const holidaySource: HolidaySource = { between: async () => holidays };
  return new ReadCalendar(source, holidaySource, { now: () => NOW });
}

function thing(over: Partial<DueThing> = {}): DueThing {
  return {
    id: 'x-1',
    kind: 'vat_return',
    clientId: 'c-1',
    clientName: 'Gulf Trading LLC',
    subject: 'vat_return',
    periodKey: '2026-Q3',
    dueOn: at('2026-09-28T00:00:00Z'),
    isDone: false,
    taskId: 't-1',
    ...over,
  };
}

/** Every entry on the month, flattened out of the grid. */
async function entriesOf(reader: ReadCalendar, month = '2026-09') {
  const view = await reader.month(MANAGER, month);
  return view.days.flatMap((day) => day.entries);
}

describe('the month a practice looks at', () => {
  it('gives every day of the month, including the empty ones', async () => {
    // A grid needs the blank days as much as the full ones, and working out
    // which weekday a month starts on is a calculation worth doing once.
    const view = await calendar([]).month(MANAGER, '2026-09');
    expect(view.days).toHaveLength(30);
    expect(view.days[0]?.date).toBe('2026-09-01');
    expect(view.days.at(-1)?.date).toBe('2026-09-30');
  });

  it('moves a filing off a weekend, and says what it was', async () => {
    // 2026-09-20 is a Sunday, and the UAE weekend has been Saturday and
    // Sunday since January 2022.
    const [entry] = await entriesOf(calendar([thing({ dueOn: at('2026-09-20T00:00:00Z') })]));

    expect(entry?.dueOn).toBe('2026-09-21');
    expect(entry?.statutoryOn).toBe('2026-09-20');
    expect(entry?.movedBecause).toBe('weekend');
  });

  it('moves a filing off a holiday, and says which', async () => {
    const reader = calendar(
      [thing({ dueOn: at('2026-09-28T00:00:00Z') })],
      [{ date: '2026-09-28', nameEn: 'Prophet birthday', nameAr: 'المولد النبوي' }],
    );

    const [entry] = await entriesOf(reader);
    expect(entry?.dueOn).toBe('2026-09-29');
    expect(entry?.movedBecause).toBe('holiday');
  });

  it('leaves a date that did not move without a statutory date to explain', async () => {
    // "Due on the 30th because the 28th was Eid" is a sentence worth showing.
    // "Due on the 28th, statutory 28th" is noise.
    const [entry] = await entriesOf(calendar([thing()]));
    expect(entry?.dueOn).toBe('2026-09-28');
    expect(entry?.statutoryOn).toBeNull();
    expect(entry?.movedBecause).toBeNull();
  });

  it('never moves a document expiry', async () => {
    /*
     * An expiry is a fact printed on the licence. It does not move because the
     * office is shut, and pretending otherwise would tell somebody their trade
     * licence is valid on a day it is not.
     */
    const [entry] = await entriesOf(
      calendar([thing({ kind: 'document_expiry', dueOn: at('2026-09-20T00:00:00Z') })]),
    );

    expect(entry?.dueOn).toBe('2026-09-20');
    expect(entry?.movedBecause).toBeNull();
  });

  it('marks a holiday on the day itself, in both languages', async () => {
    const view = await calendar(
      [],
      [{ date: '2026-09-28', nameEn: 'Prophet birthday', nameAr: 'المولد النبوي' }],
    ).month(MANAGER, '2026-09');

    const day = view.days.find((candidate) => candidate.date === '2026-09-28');
    expect(day?.holiday).toEqual({ nameEn: 'Prophet birthday', nameAr: 'المولد النبوي' });
  });

  it('marks the weekend, which is Saturday and Sunday', async () => {
    const view = await calendar([]).month(MANAGER, '2026-09');
    const weekend = view.days.filter((day) => day.isWeekend).map((day) => day.date);

    expect(weekend).toContain('2026-09-05');
    expect(weekend).toContain('2026-09-06');
    expect(weekend).not.toContain('2026-09-04');
  });

  it('counts something due before today as late', async () => {
    const [entry] = await entriesOf(calendar([thing({ dueOn: at('2026-09-10T00:00:00Z') })]));
    expect(entry?.isOverdue).toBe(true);
  });

  it('does not count work already finished as late', async () => {
    const [entry] = await entriesOf(
      calendar([thing({ dueOn: at('2026-09-10T00:00:00Z'), isDone: true })]),
    );
    expect(entry?.isOverdue).toBe(false);
  });

  it('shows an empty month to somebody who may see no clients', async () => {
    // Not an error. The same answer an accountant gets for a client that is
    // not theirs, for the same reason.
    const view = await calendar([thing()]).month(
      { userId: 'nobody', permissions: new Set<string>() },
      '2026-09',
    );

    expect(view.days.every((day) => day.entries.length === 0)).toBe(true);
    expect(view.overdue).toEqual([]);
  });

  it('falls back to this month when the month asked for is not a month', async () => {
    const view = await calendar([]).month(MANAGER, 'whenever');
    expect(view.month).toBe('2026-09');
  });

  it('reads a month at the year boundary correctly', async () => {
    const view = await calendar([]).month(MANAGER, '2026-12');
    expect(view.days).toHaveLength(31);
    expect(view.days.at(-1)?.date).toBe('2026-12-31');
  });
});
