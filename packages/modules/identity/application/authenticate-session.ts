import { type Clock, Conflict, type Result, err, ok } from '@amc/kernel';
import type { Permission, Role, User } from '../domain/index.js';
import type { SessionRepository, SessionTokenService, UserRepository } from './ports.js';

export interface AuthenticatedCaller {
  readonly userId: string;
  readonly sessionId: string;
  readonly roles: readonly Role[];
  readonly permissions: ReadonlySet<Permission>;
  readonly displayName: string;
  /** False while a password has been shown but the second factor has not. */
  readonly twoFactorPassed: boolean;
  /** True when this person is expected to present one at all. */
  readonly twoFactorRequired: boolean;
}

const REFUSED = 'Please sign in again';

/**
 * Turns the cookie on a request into a caller, or refuses.
 *
 * Every refusal reads the same, because distinguishing "no such session" from
 * "expired" from "wrong secret" tells whoever is probing which of those they
 * achieved. Using a session also slides its idle window forward, which is what
 * keeps an active user signed in.
 */
export class AuthenticateSession {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly users: UserRepository,
    private readonly tokens: SessionTokenService,
    private readonly clock: Clock,
  ) {}

  async execute(cookieValue: string): Promise<Result<AuthenticatedCaller, Conflict>> {
    const separator = cookieValue.indexOf('.');
    if (separator <= 0) return err(new Conflict(REFUSED));

    const sessionId = cookieValue.slice(0, separator);
    const token = cookieValue.slice(separator + 1);
    const now = this.clock.now();

    const found = await this.sessions.findById(sessionId);
    if (!found) return err(new Conflict(REFUSED));
    if (!this.tokens.matches(found.tokenHash, token)) return err(new Conflict(REFUSED));

    const touched = found.session.touch(now);
    if (!touched.ok) return err(new Conflict(REFUSED));
    await this.sessions.save(found.session);

    const user: User | null = await this.users.findById(found.session.userId);
    if (!user) return err(new Conflict(REFUSED));

    // A suspension takes effect on the next request, not at the next sign-in.
    const allowed = user.canSignInAt(now);
    if (!allowed.ok) return err(new Conflict(REFUSED));

    return ok({
      userId: user.id,
      sessionId: found.session.id,
      roles: [...user.roles],
      permissions: user.permissions,
      displayName: user.displayName,
      twoFactorPassed: found.session.twoFactorPassed,
      twoFactorRequired: user.twoFactorActive,
    });
  }
}
