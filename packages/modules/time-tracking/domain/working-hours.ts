import { Conflict, type Result, err, ok } from '@amc/kernel';

/**
 * Dubai is UTC+4 all year. The UAE has never observed daylight saving, which
 * is why an offset is enough here and a time zone library is not.
 */
const DUBAI_OFFSET_MINUTES = 4 * 60;

/** ISO weekday numbers: 1 is Monday, 7 is Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WorkingHoursState {
  readonly userId: string;
  /** Minutes from midnight, in Dubai. */
  readonly startsAtMinutes: number;
  readonly endsAtMinutes: number;
  readonly workingDays: readonly Weekday[];
}

/**
 * When somebody is expected to be working (FR-25).
 *
 * This exists to tell two things apart that look identical on a timesheet: a
 * timer left running overnight, and real work done late during filing season.
 * It cannot actually distinguish them — nothing can — so it does not try. It
 * marks what falls outside the working day and leaves the judgement to the
 * person who was there.
 *
 * The default is Monday to Friday, nine to six. It is a default rather than a
 * rule: plenty of practices here work Sunday to Thursday, and somebody part
 * time works neither.
 */
export class WorkingHours {
  private constructor(private readonly state: WorkingHoursState) {}

  static default(userId: string): WorkingHours {
    return new WorkingHours({
      userId,
      startsAtMinutes: 9 * 60,
      endsAtMinutes: 18 * 60,
      workingDays: [1, 2, 3, 4, 5],
    });
  }

  static of(params: {
    userId: string;
    startsAtMinutes: number;
    endsAtMinutes: number;
    workingDays: readonly number[];
  }): Result<WorkingHours, Conflict> {
    if (params.endsAtMinutes <= params.startsAtMinutes) {
      return err(new Conflict('A working day has to end after it starts'));
    }
    if (params.startsAtMinutes < 0 || params.endsAtMinutes > 24 * 60) {
      return err(new Conflict('A working day has to fall inside a day'));
    }

    const days = [...new Set(params.workingDays)].sort();
    if (days.length === 0) return err(new Conflict('Say which days are worked'));
    if (days.some((day) => day < 1 || day > 7)) {
      return err(new Conflict('Days run from Monday, which is 1, to Sunday, which is 7'));
    }

    return ok(
      new WorkingHours({
        userId: params.userId,
        startsAtMinutes: params.startsAtMinutes,
        endsAtMinutes: params.endsAtMinutes,
        workingDays: days as Weekday[],
      }),
    );
  }

  get userId(): string {
    return this.state.userId;
  }

  /** Whether an instant falls inside the working day, read in Dubai. */
  covers(instant: Date): boolean {
    const local = new Date(instant.getTime() + DUBAI_OFFSET_MINUTES * 60_000);
    // getUTCDay gives 0 for Sunday; ISO numbers Sunday as 7.
    const weekday = (local.getUTCDay() === 0 ? 7 : local.getUTCDay()) as Weekday;
    if (!this.state.workingDays.includes(weekday)) return false;

    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    return minutes >= this.state.startsAtMinutes && minutes < this.state.endsAtMinutes;
  }

  /**
   * Whether a span needs a second look.
   *
   * Three ways it can. Either end may fall outside the working day, which is
   * the obvious one. The third is less obvious and was the one this check
   * originally missed: a timer begun at five on Wednesday and stopped at half
   * past nine on Thursday has both ends inside working hours and ran through
   * the entire night. Two different local days means the span crossed a
   * boundary, whatever its endpoints look like.
   */
  questions(span: { startedAt: Date; endedAt: Date }): boolean {
    if (!this.covers(span.startedAt) || !this.covers(span.endedAt)) return true;
    return this.localDay(span.startedAt) !== this.localDay(span.endedAt);
  }

  /** The calendar day an instant falls on, in Dubai. */
  private localDay(instant: Date): string {
    return new Date(instant.getTime() + DUBAI_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
  }

  snapshot(): WorkingHoursState {
    return this.state;
  }
}
