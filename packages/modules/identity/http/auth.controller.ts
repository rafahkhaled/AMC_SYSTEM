import type { RoleName } from '@amc/contracts';
import {
  type SignInRequest,
  type SignInResponse,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInRequestSchema,
} from '@amc/contracts';
import { actorFrom } from '@amc/kernel';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedCaller } from '../application/authenticate-session.js';
import { IdentityOperations } from '../application/identity-operations.js';
import { type Role, effectiveMatrix, permissionsFor } from '../domain/index.js';
import { CurrentCaller } from './caller.js';
import { AllowPendingTwoFactor, Public } from './permissions.decorator.js';
import { ResetThrottle } from './reset-throttle.js';
import {
  COOKIE_SETTINGS,
  type CookieSettings,
  clearSessionCookie,
  setSessionCookie,
} from './session-cookie.js';
import { SignInThrottle } from './sign-in-throttle.js';

/*
 * The domain's roles and the wire's must be the same four.
 *
 * They are declared twice on purpose: the domain owns what a role means and
 * the contract owns what crosses the wire, and neither imports the other's
 * rules — the boundary linter enforces that, and caught this assertion the
 * first time it was written inside the domain. This controller is where the
 * two meet, so this is where they are checked.
 *
 * A type-level assertion, costing nothing at runtime. Add a fifth role to one
 * list and not the other and the build stops here.
 */
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _rolesMatchTheWire: Exactly<Role, RoleName> = true;
void _rolesMatchTheWire;

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(IdentityOperations) private readonly identity: IdentityOperations,
    @Inject(SignInThrottle) private readonly throttle: SignInThrottle,
    @Inject(ResetThrottle) private readonly resets: ResetThrottle,
    @Inject(COOKIE_SETTINGS) private readonly cookieSettings: CookieSettings,
  ) {}

  /**
   * "I forgot my password": a link to the address on file.
   *
   * The answer is the same whether or not the address belongs to anyone, and
   * the same whether or not it was throttled, so nothing here tells a stranger
   * who is on the system or how often somebody has asked.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() body: unknown, @Req() request: Request): Promise<{ ok: true }> {
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Give the email address you sign in with');

    if (this.resets.allow(request.ip ?? 'unknown', parsed.data.email)) {
      await this.identity.requestPasswordReset(
        {
          userId: 'anonymous',
          roles: [],
          label: parsed.data.email,
          ipAddress: request.ip ?? undefined,
          requestId: request.header('x-request-id') ?? undefined,
        },
        parsed.data.email,
        { ipAddress: request.ip ?? null },
      );
    }
    return { ok: true };
  }

  /** Choosing the new password from the link in the email. */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: unknown, @Req() request: Request): Promise<{ ok: true }> {
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Choose a new password');
    }

    // A guessing ceiling on tokens as well: they are 32 random bytes, so this
    // is belt and braces, and it costs nothing.
    if (!this.throttle.allow(`reset:${request.ip ?? 'unknown'}`)) {
      throw new HttpException(
        'Too many attempts. Try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const outcome = await this.identity.completePasswordReset(
      {
        userId: 'anonymous',
        roles: [],
        label: 'Password reset link',
        ipAddress: request.ip ?? undefined,
        requestId: request.header('x-request-id') ?? undefined,
      },
      parsed.data,
    );
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return { ok: true };
  }

  @Public()
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signInHandler(
    @Body() body: SignInRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInResponse> {
    const parsed = signInRequestSchema.safeParse(body);
    if (!parsed.success) {
      // Deliberately the same wording as a wrong password. A different message
      // for a malformed address would confirm which addresses exist.
      throw new UnauthorizedException('Those details are not right');
    }

    const source = request.ip ?? 'unknown';
    if (!this.throttle.allow(source)) {
      // Nest ships no 429 exception, so the status is given directly.
      throw new HttpException(
        'Too many attempts. Try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // The actor is unknown until the password is proven, so the attempt is
    // recorded against the address and the request rather than a person. A
    // failed sign-in still belongs in the log.
    const outcome = await this.identity.signIn(
      {
        userId: 'anonymous',
        roles: [],
        label: parsed.data.email,
        ipAddress: request.ip ?? undefined,
        requestId: request.header('x-request-id') ?? undefined,
      },
      {
        email: parsed.data.email,
        password: parsed.data.password,
        ipAddress: request.ip ?? null,
        userAgent: request.header('user-agent') ?? null,
      },
    );

    if (!outcome.ok) throw new UnauthorizedException(outcome.error.message);

    this.throttle.clear(source);
    setSessionCookie(response, outcome.value.token, this.cookieSettings);

    return {
      caller: {
        userId: outcome.value.actor.userId,
        displayName: outcome.value.displayName,
        roles: [...outcome.value.roles],
        permissions: [
          ...permissionsFor(
            outcome.value.roles,
            effectiveMatrix(await this.identity.rolePermissionChoices()),
          ),
        ],
      },
      expiresAt: outcome.value.expiresAt.toISOString(),
      twoFactorRequired: outcome.value.twoFactorRequired,
    };
  }

  @Get('me')
  me(@CurrentCaller() caller: AuthenticatedCaller): SignInResponse['caller'] {
    return {
      userId: caller.userId,
      displayName: caller.displayName,
      roles: [...caller.roles],
      permissions: [...caller.permissions],
    };
  }

  // Signing out must work even before the code has been presented, otherwise
  // an abandoned half-session can only be left to expire.
  @AllowPendingTwoFactor()
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOutHandler(
    @CurrentCaller() caller: AuthenticatedCaller,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.identity.signOutOne(actorFrom(caller), caller.sessionId);
    clearSessionCookie(response, this.cookieSettings);
  }

  @Post('sign-out-everywhere')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOutEverywhereHandler(
    @CurrentCaller() caller: AuthenticatedCaller,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.identity.signOutEverywhere(actorFrom(caller), caller.userId);
    clearSessionCookie(response, this.cookieSettings);
  }
}
