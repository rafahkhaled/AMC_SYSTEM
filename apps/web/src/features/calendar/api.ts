import { type CalendarMonth, calendarMonthSchema } from '@amc/contracts';
import { request } from '../auth/api.js';

export async function calendarMonth(month: string): Promise<CalendarMonth> {
  return calendarMonthSchema.parse(await request(`/calendar?month=${encodeURIComponent(month)}`));
}

/** The month a date falls in, as 2026-10. */
export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** The month `step` months away from `month`, without tripping over December. */
export function shiftMonth(month: string, step: number): string {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (index ?? 1) - 1 + step, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
