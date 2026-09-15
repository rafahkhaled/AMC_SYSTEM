import { SESSION_COOKIE } from '@amc/contracts';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthenticateSession } from '../application/authenticate-session.js';
import { CALLER_KEY, type RequestWithCaller } from './caller.js';
import { PENDING_TWO_FACTOR_KEY, PUBLIC_KEY } from './permissions.decorator.js';

/**
 * Closed by default. Every route requires a valid session unless it carries
 * the Public decorator, so a new controller is protected the moment it exists
 * and a forgotten annotation fails loudly rather than opening a door.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AuthenticateSession) private readonly authenticate: AuthenticateSession,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & RequestWithCaller>();
    const cookie = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!cookie) throw new UnauthorizedException('Please sign in');

    const caller = await this.authenticate.execute(cookie);
    if (!caller.ok) throw new UnauthorizedException(caller.error.message);

    // A session that has shown a password but not the code may do exactly two
    // things: present the code, or sign out. Letting it further would make the
    // second factor decorative.
    if (!caller.value.twoFactorPassed) {
      const pendingAllowed = this.reflector.getAllAndOverride<boolean>(PENDING_TWO_FACTOR_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!pendingAllowed) {
        throw new UnauthorizedException('Enter the code from your authenticator app');
      }
    }

    request[CALLER_KEY] = caller.value;
    return true;
  }
}

/**
 * Reads one cookie from the header directly, so the application needs no
 * cookie-parsing middleware and no dependency for eight lines of work.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
}
