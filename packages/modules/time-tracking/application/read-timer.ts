import type { TimeEntryView, TimerState } from '@amc/contracts';
import type { Clock } from '@amc/kernel';

/**
 * Reads what the timer screen shows.
 *
 * The queries join tasks and clients, which belong to other modules, so the
 * composition root supplies the reader. This module says what it needs; it
 * does not reach across to get it.
 */
export interface TimerViewReader {
  running(userId: string): Promise<TimerState['running']>;
  entriesOn(userId: string, day: Date): Promise<TimeEntryView[]>;
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
}
