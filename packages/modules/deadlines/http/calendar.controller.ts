import type { CalendarMonth, UpcomingDeadlines } from '@amc/contracts';
import { type Caller, CurrentCaller } from '@amc/http-kit';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ReadCalendar } from '../application/read-calendar.js';

/**
 * The month ahead.
 *
 * Not permission-guarded, for the same reason the client screens are not: the
 * two view permissions are alternatives, so naming either would lock out a
 * role. The scope decides, and someone with neither sees an empty month.
 */
@Controller('calendar')
export class CalendarController {
  constructor(@Inject(ReadCalendar) private readonly calendar: ReadCalendar) {}

  @Get()
  async month(
    @CurrentCaller() caller: Caller,
    @Query('month') month?: string,
  ): Promise<CalendarMonth> {
    // An unreadable month falls back to this one rather than being refused.
    // There is nothing a person could do with that refusal.
    return this.calendar.month(caller, month ?? '');
  }

  /**
   * What the home screen asks for: due soon, and already late.
   *
   * Declared after the month route and on its own path, so a stray `?month=`
   * cannot reach it. The window is capped — a caller asking for a year would
   * get a list nobody could read and a query nobody intended.
   */
  @Get('upcoming')
  async upcoming(
    @CurrentCaller() caller: Caller,
    @Query('days') days?: string,
  ): Promise<UpcomingDeadlines> {
    const asked = Number(days);
    const window = Number.isFinite(asked) && asked > 0 ? Math.min(Math.trunc(asked), 90) : 30;
    return this.calendar.upcoming(caller, window);
  }
}
