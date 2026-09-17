import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WorkingHoursRepository } from '../application/ports.js';
import { WorkingHours } from '../domain/working-hours.js';
import { userWorkingHours } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/** "09:00" or "09:00:00" as minutes from midnight. */
function minutesOf(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function clockOf(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export class DrizzleWorkingHoursRepository implements WorkingHoursRepository {
  constructor(private readonly db: Db) {}

  /**
   * Somebody with no row keeps the default rather than being refused.
   *
   * Everyone has working hours whether or not anybody has written them down,
   * and the alternative would be a timer that cannot be stopped until an
   * administrator fills in a form.
   */
  async forUser(userId: string): Promise<WorkingHours> {
    const [row] = await this.db
      .select()
      .from(userWorkingHours)
      .where(eq(userWorkingHours.userId, userId))
      .limit(1);

    if (!row) return WorkingHours.default(userId);

    const hours = WorkingHours.of({
      userId: row.userId,
      startsAtMinutes: minutesOf(row.startsAt),
      endsAtMinutes: minutesOf(row.endsAt),
      workingDays: row.workingDays,
    });
    // A stored row that the domain rejects means the constraints and the rules
    // have drifted. The default is the safe answer; it flags more, not less.
    return hours.ok ? hours.value : WorkingHours.default(userId);
  }

  async save(hours: WorkingHours): Promise<void> {
    const state = hours.snapshot();
    const row = {
      userId: state.userId,
      startsAt: clockOf(state.startsAtMinutes),
      endsAt: clockOf(state.endsAtMinutes),
      workingDays: [...state.workingDays],
    };
    await this.db
      .insert(userWorkingHours)
      .values(row)
      .onConflictDoUpdate({ target: userWorkingHours.userId, set: row });
  }
}
