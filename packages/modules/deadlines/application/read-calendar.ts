import type { CalendarEntry, CalendarMonth } from '@amc/contracts';
import { type Clock, heldBy } from '@amc/kernel';
import { BusinessCalendar, applyCalendar } from '../domain/index.js';
import type {
  CalendarScope,
  CallerLike,
  DeadlineSource,
  DueThing,
  HolidaySource,
} from './ports.js';

/**
 * As much of a caller as a read needs.
 *
 * Reads decide what somebody may see and write nothing, so they have no audit
 * row to name and no business demanding a display name. The use cases that do
 * write take the whole `CallerLike`.
 */
type Viewer = Pick<CallerLike, 'userId' | 'permissions'>;
/** A day as 2026-10-28, in UTC, which is how every stored date is keyed. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The month the practice looks at.
 *
 * Every date here has the business calendar applied, so what is shown is the
 * day something can actually be filed by rather than the day the law names.
 * When the two differ the entry carries both, because "due on the 30th because
 * the 28th was Eid" is a sentence a client understands and a bare date is not.
 */
export class ReadCalendar {
  constructor(
    private readonly deadlines: DeadlineSource,
    private readonly holidays: HolidaySource,
    private readonly clock: Clock,
  ) {}

  private scope(caller: Viewer): CalendarScope {
    const held = heldBy(caller);
    if (held.has('clients.view.all') || held.has('tasks.view.all')) return { kind: 'all' };
    if (held.has('clients.view.assigned')) return { kind: 'assigned', userId: caller.userId };
    return { kind: 'none' };
  }

  /** `month` is 2026-10. Anything else is treated as the current month. */
  async month(caller: Viewer, month: string): Promise<CalendarMonth> {
    const scope = this.scope(caller);
    const now = this.clock.now();
    const { start, end } = monthBounds(month, now);

    /*
     * The window reaches a week past the month's end. A deadline on the 30th
     * that is pushed into the next month by a holiday still belongs on this
     * month's grid — it is the one the person is looking at when they need to
     * know about it.
     */
    const horizon = new Date(end.getTime() + 7 * 86_400_000);
    const [things, holidays, late] = await Promise.all([
      this.deadlines.between(scope, start, horizon),
      this.holidays.between(start, horizon),
      this.deadlines.overdue(scope, now),
    ]);

    const calendar = new BusinessCalendar(holidays);
    const entries = things.map((thing) => toEntry(thing, calendar, now));

    const byDay = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const list = byDay.get(entry.dueOn) ?? [];
      list.push(entry);
      byDay.set(entry.dueOn, list);
    }

    const days: CalendarMonth['days'] = [];
    for (const date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) {
      const key = isoDay(date);
      days.push({
        date: key,
        isWeekend: calendar.isWeekend(date),
        holiday: holidayNames(calendar.holidayOn(date)),
        entries: (byDay.get(key) ?? []).sort(byClientThenKind),
      });
    }

    return {
      month: isoDay(start).slice(0, 7),
      days,
      overdue: late.map((thing) => toEntry(thing, calendar, now)).sort(byClientThenKind),
    };
  }
}

/** Both names, or nothing. The screen chooses by language, not the server. */
function holidayNames(
  holiday: { nameEn: string; nameAr: string } | null,
): { nameEn: string; nameAr: string } | null {
  return holiday ? { nameEn: holiday.nameEn, nameAr: holiday.nameAr } : null;
}

function toEntry(thing: DueThing, calendar: BusinessCalendar, now: Date): CalendarEntry {
  /*
   * A document's expiry date is a fact printed on the document. It does not
   * move because the office is shut, and pretending otherwise would tell
   * somebody their licence is valid on a day it is not.
   */
  const movable = thing.kind !== 'document_expiry';
  const computed = movable
    ? applyCalendar(thing.dueOn, calendar)
    : { statutory: thing.dueOn, effective: thing.dueOn, movedBecause: null as null };

  return {
    id: thing.id,
    kind: thing.kind,
    clientId: thing.clientId,
    clientName: thing.clientName,
    subject: thing.subject,
    periodKey: thing.periodKey,
    dueOn: isoDay(computed.effective),
    statutoryOn: computed.movedBecause ? isoDay(computed.statutory) : null,
    movedBecause: computed.movedBecause,
    isOverdue: !thing.isDone && computed.effective.getTime() < startOfDay(now).getTime(),
    isDone: thing.isDone,
    taskId: thing.taskId,
  };
}

/** Same client's obligations together, and the statutory ones first. */
const ORDER = ['vat_return', 'ct_return', 'task', 'document_expiry', 'custom'];
function byClientThenKind(a: CalendarEntry, b: CalendarEntry): number {
  return a.clientName.localeCompare(b.clientName) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The first instant of the month, and the first instant of the next one. */
function monthBounds(month: string, fallback: Date): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const year = match ? Number(match[1]) : fallback.getUTCFullYear();
  // A month given as 01-12 is one-based; Date's months are not.
  const index = match ? Number(match[2]) - 1 : fallback.getUTCMonth();
  if (!match || index < 0 || index > 11) {
    return {
      start: new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth(), 1)),
      end: new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth() + 1, 1)),
    };
  }
  return { start: new Date(Date.UTC(year, index, 1)), end: new Date(Date.UTC(year, index + 1, 1)) };
}
