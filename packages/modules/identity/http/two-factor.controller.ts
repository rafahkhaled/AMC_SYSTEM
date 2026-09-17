import {
  type TwoFactorCodeRequest,
  type TwoFactorEnrolment,
  twoFactorCodeSchema,
} from '@amc/contracts';
import { actorFrom } from '@amc/kernel';
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
import { IdentityOperations } from '../application/identity-operations.js';
import { CurrentCaller } from './caller.js';
import { AllowPendingTwoFactor } from './permissions.decorator.js';

@Controller('auth/two-factor')
export class TwoFactorController {
  constructor(@Inject(IdentityOperations) private readonly identity: IdentityOperations) {}

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

    const outcome = await this.identity.verifyTwoFactor(actorFrom(caller), {
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
    const outcome = await this.identity.startTwoFactor(actorFrom(caller), caller.userId);
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

    const outcome = await this.identity.confirmTwoFactor(actorFrom(caller), {
      userId: caller.userId,
      sessionId: caller.sessionId,
      code: parsed.data.code,
    });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
  }
}
