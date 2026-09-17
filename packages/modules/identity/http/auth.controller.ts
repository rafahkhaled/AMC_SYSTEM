import type { RoleName } from '@amc/contracts';
import { type SignInRequest, type SignInResponse, signInRequestSchema } from '@amc/contracts';
import { actorFrom } from '@amc/kernel';
import {
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
import { type Role, permissionsFor } from '../domain/index.js';
import { CurrentCaller } from './caller.js';
import { AllowPendingTwoFactor, Public } from './permissions.decorator.js';
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
    @Inject(COOKIE_SETTINGS) private readonly cookieSettings: CookieSettings,
  ) {}

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
        permissions: [...permissionsFor(outcome.value.roles)],
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
