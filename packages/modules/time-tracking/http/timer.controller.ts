import type { PendingApprovals, TimerState, Timesheet } from '@amc/contracts';
import {
  approveEntriesSchema,
  manualEntrySchema,
  startTimerSchema,
  timerActionSchema,
} from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApproveTime } from '../application/approve-time.js';
import { ReadTimer } from '../application/read-timer.js';
import { TimerService } from '../application/timer-service.js';

/**
 * The timer.
 *
 * Guarded on `time.record`, which every role that works on client projects holds
 * and the portal client does not. Unlike the client screens there is no scope
 * to fall back on: a timer belongs to the person using it, so the permission
 * is the whole check.
 */
/**
 * A replayed instant, or nothing.
 *
 * Spread rather than passed as `at: undefined`, because the service's options
 * are exact and an explicit undefined is not the same as an absent key. A
 * malformed value is dropped rather than refused: the person did the work,
 * and losing it over a bad timestamp would be the wrong trade — the server
 * falls back to now, which is what it did before any of this existed.
 */
function replayed(value: string | undefined): { at?: Date } {
  if (!value) return {};
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? {} : { at: parsed };
}

/** Dubai is UTC+4 all year: the UAE has never observed daylight saving. */
const DUBAI_OFFSET = '+04:00';

/** A wall-clock time the person typed, read on the clock they were reading. */
function inDubai(local: string): Date {
  return new Date(`${local}:00${DUBAI_OFFSET}`);
}

/**
 * The range asked for, or the last seven days.
 *
 * Both ends are calendar days; the end is exclusive, so a range that names
 * today includes today rather than stopping at midnight this morning.
 */
function weekFrom(from?: string, to?: string): { start: Date; end: Date } {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const end = to && day.test(to) ? new Date(`${to}T00:00:00.000Z`) : startOfToday();
  end.setUTCDate(end.getUTCDate() + 1);

  const start =
    from && day.test(from)
      ? new Date(`${from}T00:00:00.000Z`)
      : new Date(end.getTime() - 7 * 86_400_000);

  return { start, end };
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

@Controller('timer')
export class TimerController {
  constructor(
    @Inject(TimerService) private readonly timer: TimerService,
    @Inject(ReadTimer) private readonly read: ReadTimer,
    @Inject(ApproveTime) private readonly approvals: ApproveTime,
  ) {}

  @Get()
  @RequirePermissions('time.record')
  async state(@CurrentCaller() caller: Caller): Promise<TimerState> {
    return this.read.forUser(caller.userId);
  }

  @Post('start')
  @RequirePermissions('time.record')
  async start(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<TimerState> {
    const parsed = startTimerSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Which project?');

    const outcome = await this.timer.start({
      userId: caller.userId,
      projectId: parsed.data.projectId,
      ...replayed(parsed.data.at),
    });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);

    return this.read.forUser(caller.userId);
  }

  @Post('stop')
  @RequirePermissions('time.record')
  async stop(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<TimerState> {
    const outcome = await this.timer.stop({
      userId: caller.userId,
      ...replayed(timerActionSchema.safeParse(body).data?.at),
    });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return this.read.forUser(caller.userId);
  }

  /**
   * Hold. The interruption is not billed and the project is not lost.
   *
   * Separate from stop because the two mean different things to the person
   * using it, even though both write the same entry: stopping says the work
   * is finished, holding says it is interrupted.
   */
  @Post('hold')
  @RequirePermissions('time.record')
  async hold(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<TimerState> {
    const outcome = await this.timer.hold({
      userId: caller.userId,
      ...replayed(timerActionSchema.safeParse(body).data?.at),
    });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return this.read.forUser(caller.userId);
  }

  @Post('resume')
  @RequirePermissions('time.record')
  async resume(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<TimerState> {
    const outcome = await this.timer.resume({
      userId: caller.userId,
      ...replayed(timerActionSchema.safeParse(body).data?.at),
    });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return this.read.forUser(caller.userId);
  }

  /**
   * Record work that was done but not timed (FR-22).
   *
   * The times arrive as the browser's `datetime-local` writes them — wall
   * clock, no zone — and are read in Dubai time, because that is the clock
   * the person was looking at. Interpreting them as UTC would move every
   * entry four hours and nobody would notice until a statement was queried.
   */
  @Post('entries')
  @RequirePermissions('time.record')
  async record(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<TimerState> {
    const parsed = manualEntrySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That entry is incomplete');
    }

    const outcome = await this.timer.recordManual({
      userId: caller.userId,
      projectId: parsed.data.projectId,
      startedAt: inDubai(parsed.data.startedAt),
      endedAt: inDubai(parsed.data.endedAt),
      reason: parsed.data.reason,
      billable: parsed.data.billable,
      ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
    });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);

    return this.read.forUser(caller.userId);
  }

  /**
   * A manager approves recorded time, so it can be billed (FR-23, FR-31).
   *
   * The step that was missing. `unbilledForClient` requires `approved_at` and
   * nothing in the system could set it, so every statement would have come
   * out empty — the hours were being recorded into a state they could never
   * leave.
   *
   * `time.edit.any`, which is the manager's, rather than a new permission:
   * the SRS names the permissions and inventing one here would put a word in
   * its mouth.
   */
  /**
   * What is waiting for a manager to approve it (FR-23).
   *
   * The other half of approval: approving by id needs somewhere the ids can
   * be seen, and a timesheet is a person's own day totals.
   */
  @Get('approvals')
  @RequirePermissions('time.edit.any')
  async pending(): Promise<PendingApprovals> {
    return { entries: await this.read.pendingApprovals() };
  }

  @Post('entries/approve')
  @RequirePermissions('time.edit.any')
  async approve(
    @CurrentCaller() caller: Caller,
    @Body() body: unknown,
  ): Promise<{ approved: string[]; refused: { id: string; because: string }[] }> {
    const parsed = approveEntriesSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Nothing to approve');
    }

    const outcome = await this.approvals.execute(caller.userId, parsed.data.entryIds);
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return outcome.value;
  }

  /**
   * A person's own time over a range, day by day (FR-24).
   *
   * Their own, always. Whose hours somebody may look at is a question about
   * management reporting, and answering it accidentally through a query
   * parameter is not how it should be settled.
   */
  @Get('timesheet')
  @RequirePermissions('time.record')
  async timesheet(
    @CurrentCaller() caller: Caller,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<Timesheet> {
    const { start, end } = weekFrom(from, to);
    return this.read.timesheet(caller.userId, start, end);
  }

  /**
   * The person who was there says a flagged entry is right (FR-25).
   *
   * Their own entries only. Nobody else can vouch for whether you were really
   * working at nine in the evening, so the check is not a permission but the
   * assignment the entry hangs from.
   */
  @Post('entries/:entryId/confirm')
  @RequirePermissions('time.record')
  async confirm(
    @CurrentCaller() caller: Caller,
    @Param('entryId') entryId: string,
  ): Promise<TimerState> {
    const outcome = await this.timer.confirm({ userId: caller.userId, entryId });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return this.read.forUser(caller.userId);
  }

  /**
   * Still here. Sent while the timer is on screen, so a browser closed on
   * Friday is distinguishable from somebody working late.
   */
  @Post('beat')
  @RequirePermissions('time.record')
  @HttpCode(HttpStatus.NO_CONTENT)
  async beat(@CurrentCaller() caller: Caller): Promise<void> {
    await this.timer.beat(caller.userId);
  }
}
