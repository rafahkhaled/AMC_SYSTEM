import {
  type TwoFactorCodeRequest,
  type TwoFactorEnrolment,
  twoFactorCodeSchema,
} from '@amc/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedCaller } from '../application/authenticate-session.js';
import {
  ConfirmTwoFactorEnrolment,
  StartTwoFactorEnrolment,
  VerifyTwoFactor,
} from '../application/two-factor.js';
import { CurrentCaller } from './caller.js';
import { AllowPendingTwoFactor } from './permissions.decorator.js';

@Controller('auth/two-factor')
export class TwoFactorController {
  constructor(
    @Inject(StartTwoFactorEnrolment) private readonly start: StartTwoFactorEnrolment,
    @Inject(ConfirmTwoFactorEnrolment) private readonly confirm: ConfirmTwoFactorEnrolment,
    @Inject(VerifyTwoFactor) private readonly verify: VerifyTwoFactor,
  ) {}

  /**
   * The second step of signing in. Reachable by a session that has shown a
   * password and nothing else, which is the only thing such a session can do.
   */
  @AllowPendingTwoFactor()
  @Post('verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyHandler(
    @CurrentCaller() caller: AuthenticatedCaller,
    @Body() body: TwoFactorCodeRequest,
  ): Promise<void> {
    const parsed = twoFactorCodeSchema.safeParse(body);
    if (!parsed.success) throw new UnauthorizedException('That code is not right');

    const outcome = await this.verify.execute({
      sessionId: caller.sessionId,
      code: parsed.data.code,
    });
    if (!outcome.ok) throw new UnauthorizedException(outcome.error.message);
  }

  /**
   * Begins enrolment and returns the secret once. It is shown to the person
   * setting it up and never stored in the clear, so there is nowhere to read
   * it from afterwards. Starting again produces a new one.
   */
  @Post('enrol')
  async enrolHandler(@CurrentCaller() caller: AuthenticatedCaller): Promise<TwoFactorEnrolment> {
    const outcome = await this.start.execute(caller.userId);
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return outcome.value;
  }

  /** Proves the authenticator app holds the secret, and only then switches it on. */
  @Post('confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmHandler(
    @CurrentCaller() caller: AuthenticatedCaller,
    @Body() body: TwoFactorCodeRequest,
  ): Promise<void> {
    const parsed = twoFactorCodeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('That code is not right');

    const outcome = await this.confirm.execute({
      userId: caller.userId,
      sessionId: caller.sessionId,
      code: parsed.data.code,
    });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
  }
}
