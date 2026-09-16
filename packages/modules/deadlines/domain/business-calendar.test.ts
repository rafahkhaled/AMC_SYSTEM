import { describe, expect, it } from 'vitest';
import { BusinessCalendar, type Holiday } from './business-calendar.js';

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

const HOLIDAYS: Holiday[] = [
  { date: '2026-12-01', nameEn: 'Commemoration Day', nameAr: 'يوم الشهيد' },
  { date: '2026-12-02', nameEn: 'National Day', nameAr: 'اليوم الوطني' },
  { date: '2026-12-03', nameEn: 'National Day', nameAr: 'اليوم الوطني' },
];

const calendar = new BusinessCalendar(HOLIDAYS);

describe('the UAE working week', () => {
  it('treats Saturday and Sunday as the weekend', () => {
    // 2026-09-19 is a Saturday, 2026-09-20 a Sunday.
    expect(calendar.isWeekend(at('2026-09-19'))).toBe(true);
    expect(calendar.isWeekend(at('2026-09-20'))).toBe(true);
  });

  it('treats Friday as a working day', () => {
    // The weekend moved in January 2022. Getting this backwards would shift
    // every deadline by two days, in the direction that makes them late.
    expect(calendar.isWeekend(at('2026-09-18'))).toBe(false);
    expect(calendar.isBusinessDay(at('2026-09-18'))).toBe(true);
  });

  it('knows the fixed national holidays it was given', () => {
    expect(calendar.isBusinessDay(at('2026-12-02'))).toBe(false);
    expect(calendar.holidayOn(at('2026-12-02'))?.nameAr).toBe('اليوم الوطني');
  });
});

describe('moving to an open day', () => {
  it('leaves an ordinary working day alone', () => {
    expect(calendar.nextBusinessDay(at('2026-09-17')).toISOString().slice(0, 10)).toBe(
      '2026-09-17',
    );
  });

  it('moves a Saturday to the Monday', () => {
    expect(calendar.nextBusinessDay(at('2026-09-19')).toISOString().slice(0, 10)).toBe(
      '2026-09-21',
    );
  });

  it('steps over a run of holidays and a weekend together', () => {
    // 1 to 3 December are holidays; the 4th is a Friday and a working day.
    expect(calendar.nextBusinessDay(at('2026-12-01')).toISOString().slice(0, 10)).toBe(
      '2026-12-04',
    );
  });

  it('never moves backwards', () => {
    // The authority cannot accept a filing on a day it is closed, and moving
    // back would shorten the time available.
    const moved = calendar.nextBusinessDay(at('2026-09-19'));
    expect(moved.getTime()).toBeGreaterThan(at('2026-09-19').getTime());
  });

  it('finds the previous open day when counting backwards', () => {
    expect(calendar.previousBusinessDay(at('2026-09-20')).toISOString().slice(0, 10)).toBe(
      '2026-09-18',
    );
  });

  it('fails loudly rather than hanging on a calendar full of holidays', () => {
    const impossible = new BusinessCalendar(
      Array.from({ length: 40 }, (_, index) => ({
        date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
        nameEn: 'Nonsense',
        nameAr: 'خطأ',
      })),
    );
    expect(() => impossible.nextBusinessDay(at('2026-01-01'))).toThrow(/holiday calendar is wrong/);
  });
});

describe('counting open days', () => {
  it('skips the weekend', () => {
    // Thursday to the following Tuesday: Friday, Monday, Tuesday are open.
    expect(calendar.businessDaysBetween(at('2026-09-17'), at('2026-09-22'))).toBe(3);
  });

  it('is zero when the dates are the same or backwards', () => {
    expect(calendar.businessDaysBetween(at('2026-09-17'), at('2026-09-17'))).toBe(0);
    expect(calendar.businessDaysBetween(at('2026-09-20'), at('2026-09-17'))).toBe(0);
  });
});
