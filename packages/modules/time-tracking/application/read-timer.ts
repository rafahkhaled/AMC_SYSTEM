import type { PendingApproval, TimeEntryView, TimerState, Timesheet } from '@amc/contracts';
import { type Clock } from '@amc/kernel';

/**
 * Reads what the timer screen shows.
 *
 * The queries join projects and clients, which belong to other modules, so the
 * composition root supplies the reader. This module says what it needs; it
 * does not reach across to get it.
 */
export interface TimerViewReader {
  running(userId: string): Promise<TimerState['running']>;
  entriesOn(userId: string, day: Date): Promise<TimeEntryView[]>;
  /** Everything recorded between two instants, for the timesheet (FR-24). */
  entriesBetween(userId: string, from: Date, to: Date): Promise<TimeEntryView[]>;
  /** Finished, unapproved, not yet billed: the manager's queue (FR-23). */
  awaitingApproval(limit: number): Promise<PendingApproval[]>;
}

export class ReadTimer {
  constructor(
    private readonly reader: TimerViewReader,
    private readonly clock: Clock,
  ) {}

  async forUser(userId: string): Promise<TimerState> {
    const now = this.clock.now();
    const [running, today] = await Promise.all([
      this.reader.running(userId),
      this.reader.entriesOn(userId, now),
    ]);

    return {
      running,
      today,
      todaySeconds: today.reduce((total, entry) => total + entry.seconds, 0),
      todayBillableSeconds: today
        .filter((entry) => entry.billable)
        .reduce((total, entry) => total + entry.seconds, 0),
    };
  }

  /**
   * A person's week, day by day (FR-24).
   *
   * Every day in the range appears, including the ones with nothing on them.
   * A week that silently omits Wednesday looks like a week with no Wednesday,
   * and a blank row is the point: it is what a person is looking for when
   * they check whether they forgot to record something.
   */
  async timesheet(userId: string, from: Date, to: Date): Promise<Timesheet> {
    const entries = await this.reader.entriesBetween(userId, from, to);

    const byDay = new Map<string, { seconds: number; billableSeconds: number }>();
    for (const entry of entries) {
      const day = entry.startedAt.slice(0, 10);
      const totals = byDay.get(day) ?? { seconds: 0, billableSeconds: 0 };
      totals.seconds += entry.seconds;
      if (entry.billable) totals.billableSeconds += entry.seconds;
      byDay.set(day, totals);
    }

    const days: Timesheet['days'] = [];
    for (const cursor = new Date(from); cursor < to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const day = cursor.toISOString().slice(0, 10);
      const totals = byDay.get(day) ?? { seconds: 0, billableSeconds: 0 };
      days.push({ day, ...totals });
    }

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      days,
      totalSeconds: entries.reduce((total, entry) => total + entry.seconds, 0),
      billableSeconds: entries
        .filter((entry) => entry.billable)
        .reduce((total, entry) => total + entry.seconds, 0),
      entries,
    };
  }

  /**
   * What is waiting to be approved, across the practice.
   *
   * Not scoped to one person's clients: only `time.edit.any` reaches it, which
   * is the manager, and a manager who can only approve some of the week's time
   * would leave the rest unbillable with nobody able to say why.
   */
  async pendingApprovals(limit = 200): Promise<PendingApproval[]> {
    return this.reader.awaitingApproval(limit);
  }
}
