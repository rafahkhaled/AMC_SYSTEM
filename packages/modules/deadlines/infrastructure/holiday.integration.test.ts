import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCalendar, statutoryVatReturnDate } from '../domain/index.js';
import { DrizzleHolidayRepository } from './holiday.repository.js';

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = (date: Date) => date.toISOString().slice(0, 10);

describe('the holiday calendar against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  const repository = (tx: unknown) =>
    new DrizzleHolidayRepository(tx as ReturnType<typeof drizzle>);

  it('loads the fixed national holidays that shipped with the migration', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const calendar = await repository(tx).calendarFor(at('2026-11-01'), at('2026-12-31'));
      expect(calendar.holidayOn(at('2026-12-02'))?.nameAr).toBe('اليوم الوطني');
      expect(calendar.isBusinessDay(at('2026-12-02'))).toBe(false);
    });
  });

  it('applies a stored holiday to a real filing date', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const holidays = repository(tx);
      // Eid al Fitr is lunar, so it is added when announced rather than
      // computed. Suppose it lands on the 28th, which is a Tuesday.
      await holidays.add({
        date: '2026-07-28',
        nameEn: 'Eid al Fitr',
        nameAr: 'عيد الفطر',
        confirmed: true,
      });

      const calendar = await holidays.calendarFor(at('2026-07-01'), at('2026-08-31'));
      const due = applyCalendar(statutoryVatReturnDate(at('2026-06-30')), calendar);

      expect(day(due.statutory)).toBe('2026-07-28');
      expect(due.movedBecause).toBe('holiday');
      expect(day(due.effective)).toBe('2026-07-29');
    });
  });

  it('loads only the span asked for, so one year cannot affect another', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const calendar = await repository(tx).calendarFor(at('2026-01-01'), at('2026-12-31'));
      expect(calendar.known.every((holiday) => holiday.date.startsWith('2026'))).toBe(true);
    });
  });

  it('reports which years have been filled in', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const covered = await repository(tx).yearsCovered();
      const years = covered.map((entry) => entry.year);

      // A year holding only the four fixed dates is a year whose lunar
      // holidays nobody has added yet, and every deadline in it will be wrong
      // by a day or three. Better on a dashboard than discovered in April.
      expect(years).toContain(2026);
      expect(years).toContain(2027);
      expect(covered.find((entry) => entry.year === 2027)?.holidays).toBe(4);
    });
  });

  it('updates a provisional date once the government confirms it', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const holidays = repository(tx);
      await holidays.add({ date: '2027-03-20', nameEn: 'Eid al Fitr', nameAr: 'عيد الفطر' });
      await holidays.add({
        date: '2027-03-20',
        nameEn: 'Eid al Fitr',
        nameAr: 'عيد الفطر',
        confirmed: true,
      });

      const covered = await holidays.yearsCovered();
      expect(covered.find((entry) => entry.year === 2027)?.confirmed).toBe(5);
    });
  });
});
