import { and, gte, lte } from 'drizzle-orm';
import { boolean, date, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { BusinessCalendar, type Holiday } from '../domain/index.js';

export const businessHolidays = pgTable('business_holidays', {
  observedOn: date('observed_on').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  confirmed: boolean('confirmed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

type Db = PostgresJsDatabase<Record<string, unknown>>;

/**
 * Builds the calendar for a span of dates.
 *
 * Loaded per computation rather than cached for the life of the process: the
 * table is small, and a cached calendar would keep using last year's holidays
 * after somebody added this year's, which is exactly the failure nobody would
 * notice until a deadline was wrong.
 */
export class DrizzleHolidayRepository {
  constructor(private readonly db: Db) {}

  async calendarFor(from: Date, to: Date): Promise<BusinessCalendar> {
    const rows = await this.db
      .select()
      .from(businessHolidays)
      .where(
        and(
          gte(businessHolidays.observedOn, from.toISOString().slice(0, 10)),
          lte(businessHolidays.observedOn, to.toISOString().slice(0, 10)),
        ),
      );

    return new BusinessCalendar(
      rows.map(
        (row): Holiday => ({
          date: row.observedOn,
          nameEn: row.nameEn,
          nameAr: row.nameAr,
        }),
      ),
    );
  }

  /**
   * Whether the year ahead has been filled in.
   *
   * A year with only the fixed dates is a year whose lunar holidays nobody has
   * added, and every deadline computed in it will be wrong by a day or three.
   * Worth surfacing on a dashboard rather than discovering in April.
   */
  async yearsCovered(): Promise<{ year: number; holidays: number; confirmed: number }[]> {
    const rows = await this.db.select().from(businessHolidays);
    const byYear = new Map<number, { holidays: number; confirmed: number }>();

    for (const row of rows) {
      const year = Number(row.observedOn.slice(0, 4));
      const entry = byYear.get(year) ?? { holidays: 0, confirmed: 0 };
      entry.holidays += 1;
      if (row.confirmed) entry.confirmed += 1;
      byYear.set(year, entry);
    }

    return [...byYear.entries()]
      .map(([year, counts]) => ({ year, ...counts }))
      .sort((a, b) => a.year - b.year);
  }

  async add(holiday: Holiday & { confirmed?: boolean }): Promise<void> {
    await this.db
      .insert(businessHolidays)
      .values({
        observedOn: holiday.date,
        nameEn: holiday.nameEn,
        nameAr: holiday.nameAr,
        confirmed: holiday.confirmed ?? false,
      })
      .onConflictDoUpdate({
        target: businessHolidays.observedOn,
        set: {
          nameEn: holiday.nameEn,
          nameAr: holiday.nameAr,
          confirmed: holiday.confirmed ?? false,
        },
      });
  }
}
