import type { TimerState } from '@amc/contracts';
import { startTimerSchema } from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { ReadTimer } from '../application/read-timer.js';
import { TimerService } from '../application/timer-service.js';

/**
 * The timer.
 *
 * Guarded on `time.record`, which every role that works on client tasks holds
 * and the portal client does not. Unlike the client screens there is no scope
 * to fall back on: a timer belongs to the person using it, so the permission
 * is the whole check.
 */
@Controller('timer')
export class TimerController {
  constructor(
    @Inject(TimerService) private readonly timer: TimerService,
    @Inject(ReadTimer) private readonly read: ReadTimer,
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
    if (!parsed.success) throw new BadRequestException('Which task?');

    const outcome = await this.timer.start({
      userId: caller.userId,
      taskId: parsed.data.taskId,
    });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);

    return this.read.forUser(caller.userId);
  }

  @Post('stop')
  @RequirePermissions('time.record')
  async stop(@CurrentCaller() caller: Caller): Promise<TimerState> {
    const outcome = await this.timer.stop({ userId: caller.userId });
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
